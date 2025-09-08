import chalk from 'chalk';
import ora from 'ora';
import { JobManager } from './job-manager.js';
import { GitManager } from './git-manager.js';
import { ClaudeExecutor } from './claude-executor.js';
import { OpenAIService } from './openai-service.js';
import { RepositoryManager } from './repository-manager.js';
import { ConfigManager } from '../config.js';
import { Task } from '../database.js';

export class TaskExecutor {
  private jobManager: JobManager;
  private gitManager: GitManager;
  private claudeExecutor: ClaudeExecutor;
  private openaiService: OpenAIService;
  private repositoryManager: RepositoryManager;
  private configManager: ConfigManager;
  private workingDir: string;
  private repoInstructions: string | undefined;

  constructor() {
    this.jobManager = new JobManager();
    this.claudeExecutor = new ClaudeExecutor();
    this.openaiService = new OpenAIService();
    this.repositoryManager = new RepositoryManager();
    this.configManager = new ConfigManager();
    this.workingDir = '';
    this.repoInstructions = undefined;
    this.gitManager = new GitManager(''); // Will be set in executeWorkflow
  }

  async executeWorkflow(): Promise<void> {
    try {
      console.log(chalk.blue.bold('🚀 Starting Ivan workflow'));
      console.log('');

      console.log(chalk.blue('🔍 Validating dependencies...'));
      this.claudeExecutor.validateClaudeCodeInstallation();
      console.log(chalk.green('✅ Claude Code CLI is installed'));

      this.workingDir = await this.repositoryManager.getValidWorkingDirectory();
      this.gitManager = new GitManager(this.workingDir);

      this.gitManager.validateGitHubCliInstallation();
      console.log(chalk.green('✅ GitHub CLI is installed'));

      this.gitManager.validateGitHubCliAuthentication();
      console.log(chalk.green('✅ GitHub CLI is authenticated'));

      const repoInfo = this.repositoryManager.getRepositoryInfo(this.workingDir);
      console.log(chalk.blue(`📂 Working in: ${repoInfo.name} (${repoInfo.branch})`));
      console.log('');

      // Check for repository-specific instructions
      this.repoInstructions = await this.configManager.getRepoInstructions(this.workingDir);
      if (!this.repoInstructions) {
        console.log(chalk.yellow('⚠️  No repository-specific instructions found for this repository.'));
        const inquirer = (await import('inquirer')).default;
        const { shouldSetInstructions } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'shouldSetInstructions',
            message: 'Would you like to set repository-specific instructions now?',
            default: false
          }
        ]);

        if (shouldSetInstructions) {
          this.repoInstructions = await this.configManager.promptForRepoInstructions(this.workingDir);
        }
        console.log('');
      } else {
        console.log(chalk.green('✅ Repository-specific instructions loaded'));
      }

      const { tasks } = await this.jobManager.promptForTasks(this.workingDir);

      console.log('');

      // Ask if user wants to confirm before each task
      let confirmBeforeEach = false;
      if (tasks.length > 1) {
        const inquirer = (await import('inquirer')).default;
        const { shouldConfirm } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'shouldConfirm',
            message: 'Would you like to confirm before executing each task?',
            default: false
          }
        ]);
        confirmBeforeEach = shouldConfirm;
      }

      console.log(chalk.blue.bold('📋 Executing tasks...'));

      for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i];

        if (confirmBeforeEach) {
          console.log('');
          console.log(chalk.yellow(`Task ${i + 1} of ${tasks.length}: ${task.description}`));

          const inquirer = (await import('inquirer')).default;
          const { shouldExecute } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'shouldExecute',
              message: 'Execute this task?',
              default: true
            }
          ]);

          if (!shouldExecute) {
            console.log(chalk.gray('⏭️  Skipping task'));
            await this.jobManager.updateTaskStatus(task.uuid, 'not_started');
            continue;
          }
        }

        await this.executeTask(task);
      }

      console.log('');
      console.log(chalk.green.bold('🎉 All tasks completed successfully!'));

    } catch (error) {
      console.error(chalk.red.bold('❌ Workflow failed:'), error);
      throw error;
    } finally {
      this.jobManager.close();
    }
  }

  private async executeTask(task: Task): Promise<void> {
    console.log('');
    console.log(chalk.cyan.bold(`📝 Task: ${task.description}`));

    let spinner = ora('Updating task status...').start();

    try {
      await this.jobManager.updateTaskStatus(task.uuid, 'active');
      spinner.succeed('Task marked as active');

      spinner = ora('Cleaning up and syncing with main branch...').start();
      await this.gitManager.cleanupAndSyncMain();
      spinner.succeed('Repository cleaned and synced with main');

      const branchName = this.gitManager.generateBranchName(task.description);

      spinner = ora(`Creating branch: ${branchName}`).start();
      await this.gitManager.createBranch(branchName);
      spinner.succeed(`Branch created: ${branchName}`);

      spinner = ora('Executing task with Claude Code...').start();
      
      // Append repository-specific instructions to the task if they exist
      let taskWithInstructions = task.description;
      if (this.repoInstructions) {
        taskWithInstructions = `${task.description}\n\nRepository-specific instructions:\n${this.repoInstructions}`;
      }
      
      const executionLog = await this.claudeExecutor.executeTask(taskWithInstructions, this.workingDir);
      spinner.succeed('Claude Code execution completed');

      spinner = ora('Storing execution log...').start();
      await this.jobManager.updateTaskExecutionLog(task.uuid, executionLog);
      spinner.succeed('Execution log stored');

      const changedFiles = this.gitManager.getChangedFiles();
      if (changedFiles.length === 0) {
        console.log(chalk.yellow('⚠️  No changes detected, skipping commit and PR creation'));
        await this.jobManager.updateTaskStatus(task.uuid, 'completed');
        return;
      }

      const diff = this.gitManager.getDiff();

      spinner = ora('Generating commit message...').start();
      const commitMessage = await this.openaiService.generateCommitMessage(diff, changedFiles);
      spinner.succeed(`Commit message generated: ${commitMessage}`);

      spinner = ora('Committing changes...').start();
      await this.gitManager.commitChanges(commitMessage);
      spinner.succeed('Changes committed');

      spinner = ora('Pushing branch...').start();
      await this.gitManager.pushBranch(branchName);
      spinner.succeed('Branch pushed to origin');

      spinner = ora('Generating PR description...').start();
      const { title, body } = await this.openaiService.generatePullRequestDescription(
        task.description,
        diff,
        changedFiles
      );
      spinner.succeed('PR description generated');

      spinner = ora('Creating pull request...').start();
      const prUrl = await this.gitManager.createPullRequest(title, body);
      spinner.succeed(`Pull request created: ${prUrl}`);

      await this.jobManager.updateTaskPrLink(task.uuid, prUrl);
      await this.jobManager.updateTaskStatus(task.uuid, 'completed');

      console.log(chalk.green(`✅ Task completed: ${task.description}`));
      console.log(chalk.cyan(`🔗 PR: ${prUrl}`));

    } catch (error) {
      if (spinner.isSpinning) {
        spinner.fail('Task execution failed');
      }

      // Store error log if execution failed
      try {
        const errorLog = error instanceof Error ? error.message : String(error);
        await this.jobManager.updateTaskExecutionLog(task.uuid, `ERROR: ${errorLog}`);
        console.log(chalk.gray('Error log stored to database'));
      } catch (logError) {
        console.error(chalk.red('Failed to store error log:'), logError);
      }

      console.error(chalk.red(`❌ Failed to execute task: ${task.description}`), error);
      throw error;
    }
  }
}

