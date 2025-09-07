import chalk from 'chalk';
import ora from 'ora';
import { JobManager } from './job-manager.js';
import { GitManager } from './git-manager.js';
import { ClaudeExecutor } from './claude-executor.js';
import { OpenAIService } from './openai-service.js';
import { Task } from '../database.js';

export class TaskExecutor {
  private jobManager: JobManager;
  private gitManager: GitManager;
  private claudeExecutor: ClaudeExecutor;
  private openaiService: OpenAIService;

  constructor() {
    this.jobManager = new JobManager();
    this.gitManager = new GitManager();
    this.claudeExecutor = new ClaudeExecutor();
    this.openaiService = new OpenAIService();
  }

  async executeWorkflow(): Promise<void> {
    try {
      console.log(chalk.blue.bold('🚀 Starting Ivan workflow'));
      console.log('');

      this.claudeExecutor.validateClaudeCodeInstallation();

      const { job, tasks } = await this.jobManager.promptForTasks();
      
      console.log('');
      console.log(chalk.blue.bold('📋 Executing tasks...'));

      for (const task of tasks) {
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

      const branchName = this.gitManager.generateBranchName(task.description);
      
      spinner = ora(`Creating branch: ${branchName}`).start();
      await this.gitManager.createBranch(branchName);
      spinner.succeed(`Branch created: ${branchName}`);

      spinner = ora('Executing task with Claude Code...').start();
      await this.claudeExecutor.executeTask(task.description, process.cwd());
      spinner.succeed('Claude Code execution completed');

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
      console.error(chalk.red(`❌ Failed to execute task: ${task.description}`), error);
      throw error;
    }
  }
}