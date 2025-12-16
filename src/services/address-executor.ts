import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { JobManager } from './job-manager.js';
import { PRService } from './pr-service.js';
import { RepositoryManager } from './repository-manager.js';
import { GitManager } from './git-manager.js';
import { ExecutorFactory, IClaudeExecutor } from './executor-factory.js';
import { ConfigManager } from '../config.js';
import { Task } from '../database.js';
import { AddressTaskExecutor } from './address-task-executor.js';

export class AddressExecutor {
  private jobManager: JobManager;
  private prService: PRService;
  private repositoryManager: RepositoryManager;
  private gitManager: GitManager | null = null;
  private claudeExecutor: IClaudeExecutor | null = null;
  private configManager: ConfigManager;
  private workingDir: string;

  constructor() {
    this.jobManager = new JobManager();
    this.repositoryManager = new RepositoryManager();
    this.configManager = new ConfigManager();
    this.workingDir = '';
    this.prService = {} as PRService;
  }

  private getClaudeExecutor(): IClaudeExecutor {
    if (!this.claudeExecutor) {
      this.claudeExecutor = ExecutorFactory.getExecutor();
    }
    return this.claudeExecutor;
  }

  async executeWorkflow(specificPrNumber?: number, fromUser?: string): Promise<void> {
    try {
      if (specificPrNumber) {
        console.log(chalk.blue.bold(`🔍 Checking PR #${specificPrNumber} for unaddressed issues...`));
      } else if (fromUser) {
        console.log(chalk.blue.bold(`🔍 Scanning for PRs from @${fromUser} with unaddressed issues...`));
      } else {
        console.log(chalk.blue.bold('🔍 Scanning for PRs with unaddressed issues...'));
      }
      console.log('');

      // Validate dependencies
      console.log(chalk.blue('🔍 Validating dependencies...'));
      await this.getClaudeExecutor().validateClaudeCodeInstallation();
      console.log(chalk.green('✅ Claude Code SDK configured'));

      this.workingDir = await this.repositoryManager.getValidWorkingDirectory();
      this.gitManager = new GitManager(this.workingDir);
      this.prService = new PRService(this.workingDir);

      this.gitManager.validateGitHubCliInstallation();
      console.log(chalk.green('✅ GitHub CLI is installed'));

      this.gitManager.validateGitHubCliAuthentication();
      console.log(chalk.green('✅ GitHub CLI is authenticated'));

      const repoInfo = this.repositoryManager.getRepositoryInfo(this.workingDir);
      console.log(chalk.blue(`📂 Working in: ${repoInfo.name}`));
      console.log('');

      // Get or create repository in database
      const repository = await this.repositoryManager.getOrCreateRepository(this.workingDir);

      // Fetch PRs with issues
      const spinner = ora(specificPrNumber ? `Fetching PR #${specificPrNumber}...` : 'Fetching open PRs...').start();
      const prsWithIssues = specificPrNumber
        ? await this.prService.getSpecificPRWithIssues(specificPrNumber)
        : await this.prService.getOpenPRsWithIssues(fromUser);
      spinner.succeed(`Found ${prsWithIssues.length} PRs with unaddressed issues`);

      if (prsWithIssues.length === 0) {
        if (specificPrNumber) {
          console.log(chalk.green(`✨ PR #${specificPrNumber} has no unaddressed comments or failing checks!`));
        } else {
          console.log(chalk.green('✨ No PRs with unaddressed comments or failing checks found!'));
        }
        return;
      }

      // Display PRs and let user choose
      console.log('');
      console.log(chalk.blue.bold('📋 PRs with issues:'));
      console.log('');

      const prChoices = prsWithIssues.map(pr => {
        const issues = [];
        if (pr.hasUnaddressedComments) {
          issues.push(`${pr.unaddressedComments.length} unaddressed comment(s)`);
        }
        if (pr.hasTestOrLintFailures) {
          issues.push(`${pr.testOrLintFailures.length} test/lint failure(s)`);
        } else if (pr.hasFailingChecks) {
          issues.push(`${pr.failingChecks.length} failing check(s)`);
        }

        return {
          name: `PR #${pr.number}: ${pr.title} - ${chalk.yellow(issues.join(', '))}`,
          value: pr,
          checked: true
        };
      });

      const { selectedPRs } = await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'selectedPRs',
          message: 'Select PRs to address:',
          choices: prChoices,
          validate: (input) => input.length > 0 || 'Please select at least one PR'
        }
      ]);

      // Create tasks for selected PRs
      const tasks: Array<{ description: string; prNumber: number; prBranch: string; type: 'address' | 'lint_and_test' }> = [];

      for (const pr of selectedPRs) {
        // Create tasks for unaddressed comments
        for (const comment of pr.unaddressedComments) {
          let description = `Address PR #${pr.number} comment from @${comment.author}: "${comment.body.substring(0, 100)}${comment.body.length > 100 ? '...' : ''}"`;

          if (comment.path) {
            description += ` (in ${comment.path}${comment.line ? `:${comment.line}` : ''})`;
          }

          tasks.push({
            description,
            prNumber: pr.number,
            prBranch: pr.branch,
            type: 'address'
          });
        }

        // Create task for test/lint failures if any
        if (pr.hasTestOrLintFailures && pr.testOrLintFailures.length > 0) {
          tasks.push({
            description: `Fix test and lint failures in PR #${pr.number}: ${pr.testOrLintFailures.join(', ')}`,
            prNumber: pr.number,
            prBranch: pr.branch,
            type: 'lint_and_test'
          });
        } else if (pr.hasFailingChecks && pr.failingChecks.length > 0) {
          // Only create generic failing check task if there are no test/lint failures
          const nonTestLintFailures = pr.failingChecks.filter(
            (check: string) => !pr.testOrLintFailures.includes(check)
          );
          if (nonTestLintFailures.length > 0) {
            tasks.push({
              description: `Fix failing checks in PR #${pr.number}: ${nonTestLintFailures.join(', ')}`,
              prNumber: pr.number,
              prBranch: pr.branch,
              type: 'address'
            });
          }
        }
      }

      // Display tasks to be created
      console.log('');
      console.log(chalk.blue.bold(`📝 Creating ${tasks.length} tasks:`));
      tasks.forEach((task, index) => {
        console.log(chalk.gray(`  ${index + 1}. ${task.description}`));
      });
      console.log('');

      const { confirmTasks } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirmTasks',
          message: `Create these ${tasks.length} tasks?`,
          default: true
        }
      ]);

      if (!confirmTasks) {
        console.log(chalk.yellow('⚠️  Task creation cancelled'));
        return;
      }

      // Create job and tasks in database
      const jobUuid = await this.jobManager.createJob(`Address PR issues - ${new Date().toLocaleDateString()}`, this.workingDir, repository.id);

      const createdTasks: Task[] = [];
      for (const task of tasks) {
        const taskUuid = await this.jobManager.createTask(jobUuid, task.description, repository.id, task.type);
        // Store the branch name for the task
        await this.jobManager.updateTaskBranch(taskUuid, task.prBranch);
        const createdTask = await this.jobManager.getTask(taskUuid);
        if (createdTask) {
          createdTasks.push(createdTask);
        }
      }

      console.log(chalk.green(`✅ Created ${createdTasks.length} tasks`));
      console.log('');

      // Execute tasks using the AddressTaskExecutor
      const addressTaskExecutor = new AddressTaskExecutor();
      await addressTaskExecutor.executeAddressTasks(createdTasks);

      console.log('');
      console.log(chalk.green.bold('🎉 All tasks completed successfully!'));

    } catch (error) {
      console.error(chalk.red.bold('❌ Workflow failed:'), error);
      throw error;
    } finally {
      this.jobManager.close();
    }
  }
}

