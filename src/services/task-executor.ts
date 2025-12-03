import chalk from 'chalk';
import ora from 'ora';
import { JobManager } from './job-manager.js';
import { GitManager } from './git-manager.js';
import { ExecutorFactory, IClaudeExecutor } from './executor-factory.js';
import { OpenAIService } from './openai-service.js';
import { RepositoryManager } from './repository-manager.js';
import { ConfigManager } from '../config.js';
import { Task } from '../database.js';
import { AddressTaskExecutor } from './address-task-executor.js';
import { PRService } from './pr-service.js';
import { NonInteractiveConfig } from '../types/non-interactive-config.js';

export class TaskExecutor {
  private jobManager: JobManager;
  private gitManager: GitManager | null = null;
  private claudeExecutor: IClaudeExecutor | null = null;
  private openaiService: OpenAIService | null = null;
  private repositoryManager: RepositoryManager;
  private configManager: ConfigManager;
  private workingDir: string;
  private repoInstructions: string | undefined;

  constructor() {
    this.jobManager = new JobManager();
    this.repositoryManager = new RepositoryManager();
    this.configManager = new ConfigManager();
    this.workingDir = '';
    this.repoInstructions = undefined;
  }

  private getClaudeExecutor(): IClaudeExecutor {
    if (!this.claudeExecutor) {
      this.claudeExecutor = ExecutorFactory.getExecutor();
    }
    return this.claudeExecutor;
  }

  private getOpenAIService(): OpenAIService {
    if (!this.openaiService) {
      this.openaiService = new OpenAIService();
    }
    return this.openaiService;
  }

  async executeWorkflow(): Promise<void> {
    try {
      console.log(chalk.blue.bold('🚀 Starting Ivan workflow'));
      console.log('');

      console.log(chalk.blue('🔍 Validating dependencies...'));
      await this.getClaudeExecutor().validateClaudeCodeInstallation();
      console.log(chalk.green('✅ Claude Code SDK configured'));

      this.workingDir = await this.repositoryManager.getValidWorkingDirectory();
      this.gitManager = new GitManager(this.workingDir);

      if (!this.gitManager) {
        throw new Error('GitManager not initialized');
      }
      this.gitManager.validateGitHubCliInstallation();
      console.log(chalk.green('✅ GitHub CLI is installed'));

      if (!this.gitManager) {
        throw new Error('GitManager not initialized');
      }
      this.gitManager.validateGitHubCliAuthentication();
      console.log(chalk.green('✅ GitHub CLI is authenticated'));

      const repoInfo = this.repositoryManager.getRepositoryInfo(this.workingDir);
      console.log(chalk.blue(`📂 Working in: ${repoInfo.name} (${repoInfo.branch})`));
      console.log('');

      // Check for repository-specific instructions
      this.repoInstructions = await this.configManager.getRepoInstructions(this.workingDir);
      if (!this.repoInstructions) {
        // Only prompt if the user hasn't previously declined for this repo
        const hasDeclined = await this.configManager.hasDeclinedRepoInstructions(this.workingDir);
        if (!hasDeclined) {
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
          } else {
            // Mark that the user declined so we don't ask again
            await this.configManager.markRepoInstructionsDeclined(this.workingDir);
            console.log(chalk.gray('You can configure instructions later with: ivan edit-repo-instructions'));
          }
          console.log('');
        }
      } else {
        console.log(chalk.green('✅ Repository-specific instructions loaded'));
      }

      const { tasks, prStrategy } = await this.jobManager.promptForTasks(this.workingDir);

      console.log('');

      // Check if these are address tasks
      const addressTasks = tasks.filter(t => t.type === 'address');
      const buildTasks = tasks.filter(t => t.type === 'build');

      // Handle address tasks separately
      if (addressTasks.length > 0) {
        const addressExecutor = new AddressTaskExecutor();
        await addressExecutor.executeAddressTasks(addressTasks);
      }

      // Handle build tasks
      if (buildTasks.length > 0) {
        // Ask about PR comment monitoring upfront
        let shouldWaitForComments = false;
        const inquirer = (await import('inquirer')).default;

        const { waitForComments } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'waitForComments',
            message: 'After completing tasks, would you like to wait 30 minutes for PR reviews and automatically address any comments?',
            default: false
          }
        ]);
        shouldWaitForComments = waitForComments;

        // Ask if user wants to confirm before each task
        let confirmBeforeEach = false;
        if (buildTasks.length > 1) {
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

        // Handle single PR strategy
        if (prStrategy === 'single' && buildTasks.length > 1) {
          await this.executeTasksWithSinglePR(buildTasks, confirmBeforeEach);
        } else {
          // Multiple PRs (default behavior)
          for (let i = 0; i < buildTasks.length; i++) {
            const task = buildTasks[i];

            if (confirmBeforeEach) {
              console.log('');
              console.log(chalk.yellow(`Task ${i + 1} of ${buildTasks.length}: ${task.description}`));

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
        }

        console.log('');
        console.log(chalk.green.bold('🎉 All initial tasks completed successfully!'));

        // Collect PR URLs created during this session by reloading tasks from DB
        const createdPRUrls: string[] = [];
        for (const task of buildTasks) {
          const updatedTask = await this.jobManager.getTask(task.uuid);
          if (updatedTask && updatedTask.pr_link) {
            createdPRUrls.push(updatedTask.pr_link);
          }
        }

        if (createdPRUrls.length > 0) {
          // Show PRs created
          console.log('');
          console.log(chalk.blue('📋 PRs created:'));
          createdPRUrls.forEach(url => console.log(chalk.cyan(`  - ${url}`)));

          if (shouldWaitForComments) {
            // Wait 30 minutes for reviewers to comment
            console.log('');
            console.log(chalk.blue('⏰ Waiting 30 minutes for PR reviews...'));
            console.log(chalk.gray('PRs being monitored:'));
            createdPRUrls.forEach(url => console.log(chalk.gray(`  - ${url}`)));
            console.log('');

            const waitTime = 30 * 60 * 1000; // 30 minutes in milliseconds
            const startTime = Date.now();
            const interval = setInterval(() => {
              const elapsed = Date.now() - startTime;
              const remaining = waitTime - elapsed;
              const minutes = Math.floor(remaining / 60000);
              const seconds = Math.floor((remaining % 60000) / 1000);
              process.stdout.write(`\r${chalk.blue('⏰')} Time remaining: ${minutes}:${seconds.toString().padStart(2, '0')}  `);
            }, 1000);

            await new Promise(resolve => setTimeout(resolve, waitTime));
            clearInterval(interval);
            console.log('\n');

            // Check for unaddressed comments on created PRs
            console.log(chalk.blue('🔍 Checking for PR review comments...'));
            const prService = new PRService(this.workingDir);
            const addressTasks = await this.checkAndCreateAddressTasks(createdPRUrls, prService);

            if (addressTasks.length > 0) {
              console.log('');
              console.log(chalk.blue.bold(`📋 Found ${addressTasks.length} comments to address`));

              // Execute address tasks automatically
              const addressExecutor = new AddressTaskExecutor();
              await addressExecutor.executeAddressTasks(addressTasks);

              console.log('');
              console.log(chalk.green.bold('🎉 All PR comments addressed successfully!'));
            } else {
              console.log(chalk.green('✨ No unaddressed comments found on PRs!'));
            }
          } else {
            console.log(chalk.blue('💡 You can run "ivan address" later to handle any PR comments'));
          }
        }
      }

    } catch (error) {
      console.error(chalk.red.bold('❌ Workflow failed:'), error);
      throw error;
    } finally {
      this.jobManager.close();
    }
  }

  private async checkAndCreateAddressTasks(prUrls: string[], prService: PRService): Promise<Task[]> {
    const addressTasks: Task[] = [];

    for (const prUrl of prUrls) {
      // Extract PR number from URL
      const prMatch = prUrl.match(/\/pull\/(\d+)/);
      if (!prMatch) continue;

      const prNumber = parseInt(prMatch[1]);

      // Get unaddressed comments for this PR
      const comments = await prService.getUnaddressedComments(prNumber);

      if (comments.length > 0) {
        // Get the branch name for this PR
        if (!this.gitManager) {
          throw new Error('GitManager not initialized');
        }
        const prInfo = await this.gitManager.getPRInfo(prNumber);
        const branch = prInfo.headRefName;

        // Create address tasks for each comment
        for (const comment of comments) {
          let description = `Address PR #${prNumber} comment from @${comment.author}: "${comment.body.substring(0, 100)}${comment.body.length > 100 ? '...' : ''}"`;
          if (comment.path) {
            description += ` (in ${comment.path}${comment.line ? `:${comment.line}` : ''})`;
          }

          // Get the current job ID from one of the build tasks
          const jobUuid = this.jobManager.getCurrentJobUuid() || (await this.jobManager.getLatestJobId(this.workingDir));

          // Create the address task
          const taskUuid = await this.jobManager.createTask(jobUuid, description, 'address');
          await this.jobManager.updateTaskBranch(taskUuid, branch);

          const task = await this.jobManager.getTask(taskUuid);
          if (task) {
            addressTasks.push(task);
          }
        }
      }
    }

    return addressTasks;
  }

  private async executeTask(task: Task): Promise<void> {
    console.log('');
    console.log(chalk.cyan.bold(`📝 Task: ${task.description}`));

    let spinner = ora('Updating task status...').start();
    let worktreePath: string | null = null;
    let branchName: string | null = null;

    try {
      await this.jobManager.updateTaskStatus(task.uuid, 'active');
      spinner.succeed('Task marked as active');

      spinner = ora('Cleaning up and syncing with main branch...').start();
      if (!this.gitManager) {
        throw new Error('GitManager not initialized');
      }
      await this.gitManager.cleanupAndSyncMain();
      spinner.succeed('Repository cleaned and synced with main');

      if (!this.gitManager) {
        throw new Error('GitManager not initialized');
      }
      branchName = this.gitManager.generateBranchName(task.description);

      spinner = ora(`Creating worktree for branch: ${branchName}`).start();
      worktreePath = await this.gitManager.createWorktree(branchName);
      this.gitManager.switchToWorktree(worktreePath);
      spinner.succeed(`Worktree created: ${worktreePath}`);

      await this.jobManager.updateTaskBranch(task.uuid, branchName);

      spinner = ora('Executing task with Claude Code...').start();

      // Append repository-specific instructions to the task if they exist
      let taskWithInstructions = task.description;
      if (this.repoInstructions) {
        taskWithInstructions = `${task.description}\n\nRepository-specific instructions:\n${this.repoInstructions}`;
      }

      // Retrieve relevant memories from past PR comments
      try {
        const { MemoryService } = await import('./memory-service.js');
        const memoryService = new MemoryService();
        const memories = await memoryService.retrieveSimilarMemories(
          task.description,
          this.workingDir,
          3
        );

        if (memories.length > 0) {
          taskWithInstructions += '\n\n' + this.formatMemoriesForPrompt(memories);
        }
      } catch (error) {
        // Don't fail task if memory retrieval fails
        console.error(chalk.gray('Memory retrieval failed (non-critical):'), error);
      }

      // Use worktree path for Claude execution, falling back to workingDir if needed
      const executionPath = worktreePath || this.workingDir;
      const result = await this.getClaudeExecutor().executeTask(taskWithInstructions, executionPath);
      spinner.succeed('Claude Code execution completed');

      spinner = ora('Storing execution log...').start();
      await this.jobManager.updateTaskExecutionLog(task.uuid, result.log);
      spinner.succeed('Execution log stored');

      if (!this.gitManager) {
        throw new Error('GitManager not initialized');
      }
      const changedFiles = this.gitManager.getChangedFiles();
      if (changedFiles.length === 0) {
        console.log(chalk.yellow('⚠️  No changes detected, skipping commit and PR creation'));
        await this.jobManager.updateTaskStatus(task.uuid, 'completed');
        return;
      }

      if (!this.gitManager) {
        throw new Error('GitManager not initialized');
      }
      const diff = this.gitManager.getDiff();

      spinner = ora('Generating commit message...').start();
      const commitMessage = await this.getOpenAIService().generateCommitMessage(diff, changedFiles);
      spinner.succeed(`Commit message generated: ${commitMessage}`);

      spinner = ora('Committing changes...').start();
      if (!this.gitManager) {
        throw new Error('GitManager not initialized');
      }

      // Try to commit, handling pre-commit hook failures
      let commitAttempts = 0;
      const maxCommitAttempts = 3;
      let commitSucceeded = false;

      while (commitAttempts < maxCommitAttempts && !commitSucceeded) {
        try {
          await this.gitManager.commitChanges(commitMessage);
          // Only show success message if spinner is running (first attempt)
          if (commitAttempts === 0) {
            spinner.succeed('Changes committed');
          } else if (spinner.isSpinning) {
            spinner.succeed('Commit successful after retry');
          }
          commitSucceeded = true;
        } catch (commitError) {
          commitAttempts++;

          const errorMessage = commitError instanceof Error ? commitError.message : String(commitError);

          // Check if this is a pre-commit hook failure
          if (errorMessage.includes('pre-commit') && commitAttempts < maxCommitAttempts) {
            spinner.fail(`Pre-commit hook failed (attempt ${commitAttempts}/${maxCommitAttempts})`);
            console.log(chalk.yellow('🔧 Running Claude to fix pre-commit errors...'));

            // Extract the error details from the commit error
            const errorDetails = errorMessage;

            // Prepare prompt for Claude to fix the errors
            const fixPrompt = `Fix the following pre-commit hook errors:\n\n${errorDetails}\n\nPlease fix all TypeScript errors, linting issues, and any other problems preventing the commit.`;

            spinner = ora('Running Claude to fix pre-commit errors...').start();

            try {
              // Run Claude to fix the errors
              const fixResult = await this.getClaudeExecutor().executeTask(fixPrompt, worktreePath || this.workingDir);
              spinner.succeed('Claude attempted to fix the errors');

              // Update the execution log with the fix attempt
              const previousLog = await this.jobManager.getTaskExecutionLog(task.uuid);
              await this.jobManager.updateTaskExecutionLog(
                task.uuid,
                `${previousLog}\n\n--- Pre-commit Fix Attempt ${commitAttempts} ---\n${fixResult.log}`
              );

              // Try to commit again on the next iteration
              spinner = ora('Retrying commit...').start();
            } catch (fixError) {
              spinner.fail('Failed to run Claude to fix errors');
              console.error(chalk.red('Claude fix attempt failed:'), fixError);
              throw commitError; // Re-throw the original error
            }
          } else {
            // Not a pre-commit error or max attempts reached
            throw commitError;
          }
        }
      }

      if (!commitSucceeded) {
        throw new Error(`Failed to commit after ${maxCommitAttempts} attempts due to pre-commit hook failures`);
      }

      spinner = ora('Pushing branch...').start();
      if (!this.gitManager) {
        throw new Error('GitManager not initialized');
      }
      await this.gitManager.pushBranch(branchName);
      spinner.succeed('Branch pushed to origin');

      spinner = ora('Generating PR description...').start();
      const { title, body } = await this.getOpenAIService().generatePullRequestDescription(
        task.description,
        diff,
        changedFiles
      );
      spinner.succeed('PR description generated');

      spinner = ora('Creating pull request...').start();
      if (!this.gitManager) {
        throw new Error('GitManager not initialized');
      }
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
    } finally {
      // Switch back to original directory and clean up worktree
      if (this.gitManager && worktreePath && branchName) {
        this.gitManager.switchToOriginalDir();
        await this.gitManager.removeWorktree(branchName);
      }
    }
  }

  private async executeTasksWithSinglePR(tasks: Task[], confirmBeforeEach: boolean): Promise<void> {
    console.log('');
    console.log(chalk.blue('📦 Creating single branch for all tasks...'));

    let spinner = ora('Cleaning up and syncing with main branch...').start();
    let worktreePath: string | null = null;
    let branchName: string | null = null;
    let sessionId: string | undefined;

    try {
      if (!this.gitManager) {
        throw new Error('GitManager not initialized');
      }
      await this.gitManager.cleanupAndSyncMain();
      spinner.succeed('Repository cleaned and synced with main');

      // Generate branch name based on all tasks
      const combinedDescription = tasks.length === 1
        ? tasks[0].description
        : `Multiple tasks: ${tasks.slice(0, 2).map(t => t.description).join(', ')}${tasks.length > 2 ? '...' : ''}`;

      branchName = this.gitManager.generateBranchName(combinedDescription);

      spinner = ora(`Creating worktree for branch: ${branchName}`).start();
      worktreePath = await this.gitManager.createWorktree(branchName);
      this.gitManager.switchToWorktree(worktreePath);
      spinner.succeed(`Worktree created: ${worktreePath}`);

      // Update all tasks with the same branch
      for (const task of tasks) {
        await this.jobManager.updateTaskBranch(task.uuid, branchName);
      }

      // Execute each task on the same branch
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

        console.log('');
        console.log(chalk.cyan.bold(`📝 Task ${i + 1}/${tasks.length}: ${task.description}`));

        spinner = ora('Updating task status...').start();
        await this.jobManager.updateTaskStatus(task.uuid, 'active');
        spinner.succeed('Task marked as active');

        spinner = ora('Executing task with Claude Code...').start();

        // Append repository-specific instructions to the task if they exist
        let taskWithInstructions = task.description;
        if (this.repoInstructions) {
          taskWithInstructions = `${task.description}\n\nRepository-specific instructions:\n${this.repoInstructions}`;
        }

        // Use worktree path for Claude execution
        const executionPath = worktreePath || this.workingDir;
        // Pass session ID to maintain context between tasks
        const result = await this.getClaudeExecutor().executeTask(taskWithInstructions, executionPath, sessionId);
        // Store the session ID for the next task
        sessionId = result.sessionId;
        spinner.succeed('Claude Code execution completed');

        spinner = ora('Storing execution log...').start();
        await this.jobManager.updateTaskExecutionLog(task.uuid, result.log);
        spinner.succeed('Execution log stored');

        // Commit changes after each task (but don't create PR yet)
        if (!this.gitManager) {
          throw new Error('GitManager not initialized');
        }
        const changedFiles = this.gitManager.getChangedFiles();
        if (changedFiles.length > 0) {
          const diff = this.gitManager.getDiff();

          spinner = ora('Generating commit message...').start();
          const commitMessage = await this.getOpenAIService().generateCommitMessage(diff, changedFiles);
          spinner.succeed(`Commit message generated: ${commitMessage}`);

          spinner = ora('Committing changes...').start();

          // Try to commit, handling pre-commit hook failures
          let commitAttempts = 0;
          const maxCommitAttempts = 3;
          let commitSucceeded = false;

          while (commitAttempts < maxCommitAttempts && !commitSucceeded) {
            try {
              await this.gitManager.commitChanges(commitMessage);
              // Only show success message if spinner is running (first attempt)
              if (commitAttempts === 0) {
                spinner.succeed('Changes committed');
              } else if (spinner.isSpinning) {
                spinner.succeed('Commit successful after retry');
              }
              commitSucceeded = true;
            } catch (commitError) {
              commitAttempts++;

              const errorMessage = commitError instanceof Error ? commitError.message : String(commitError);

              // Check if this is a pre-commit hook failure
              if (errorMessage.includes('pre-commit') && commitAttempts < maxCommitAttempts) {
                spinner.fail(`Pre-commit hook failed (attempt ${commitAttempts}/${maxCommitAttempts})`);
                console.log(chalk.yellow('🔧 Running Claude to fix pre-commit errors...'));

                // Extract the error details from the commit error
                const errorDetails = errorMessage;

                // Prepare prompt for Claude to fix the errors
                const fixPrompt = `Fix the following pre-commit hook errors:\n\n${errorDetails}\n\nPlease fix all TypeScript errors, linting issues, and any other problems preventing the commit.`;

                spinner = ora('Running Claude to fix pre-commit errors...').start();

                try {
                  // Run Claude to fix the errors (pass session ID to maintain context)
                  const fixResult = await this.getClaudeExecutor().executeTask(fixPrompt, executionPath, sessionId);
                  // Update session ID
                  sessionId = fixResult.sessionId;
                  spinner.succeed('Claude attempted to fix the errors');

                  // Update the execution log with the fix attempt
                  const previousLog = await this.jobManager.getTaskExecutionLog(task.uuid);
                  await this.jobManager.updateTaskExecutionLog(
                    task.uuid,
                    `${previousLog}\n\n--- Pre-commit Fix Attempt ${commitAttempts} ---\n${fixResult.log}`
                  );

                  // Try to commit again on the next iteration
                  spinner = ora('Retrying commit...').start();
                } catch (fixError) {
                  spinner.fail('Failed to run Claude to fix errors');
                  console.error(chalk.red('Claude fix attempt failed:'), fixError);
                  throw commitError; // Re-throw the original error
                }
              } else {
                // Not a pre-commit error or max attempts reached
                throw commitError;
              }
            }
          }

          if (!commitSucceeded) {
            throw new Error(`Failed to commit after ${maxCommitAttempts} attempts due to pre-commit hook failures`);
          }
        } else {
          console.log(chalk.yellow('⚠️  No changes detected for this task'));
        }

        await this.jobManager.updateTaskStatus(task.uuid, 'completed');
        console.log(chalk.green(`✅ Task ${i + 1}/${tasks.length} completed`));
      }

      // After all tasks are complete, create a single PR
      spinner = ora('Pushing branch...').start();
      if (!this.gitManager) {
        throw new Error('GitManager not initialized');
      }
      await this.gitManager.pushBranch(branchName);
      spinner.succeed('Branch pushed to origin');

      // Generate PR description based on all tasks
      spinner = ora('Generating pull request description...').start();
      const allTaskDescriptions = tasks.map(t => `- ${t.description}`).join('\n');
      const prTaskDescription = `Completed ${tasks.length} tasks:\n\n${allTaskDescriptions}`;

      // Get combined diff for PR description
      const finalDiff = this.gitManager.getDiff('origin/main', 'HEAD');
      const allChangedFiles = this.gitManager.getChangedFiles('origin/main');

      const { title, body } = await this.getOpenAIService().generatePullRequestDescription(
        prTaskDescription,
        finalDiff,
        allChangedFiles
      );
      spinner.succeed('PR description generated');

      spinner = ora('Creating pull request...').start();
      const prUrl = await this.gitManager.createPullRequest(title, body);
      spinner.succeed(`Pull request created: ${prUrl}`);

      // Update all tasks with the same PR link
      for (const task of tasks) {
        await this.jobManager.updateTaskPrLink(task.uuid, prUrl);
      }

      console.log('');
      console.log(chalk.green.bold(`✅ All ${tasks.length} tasks completed in a single PR!`));
      console.log(chalk.cyan(`🔗 PR: ${prUrl}`));

    } catch (error) {
      if (spinner && spinner.isSpinning) {
        spinner.fail('Batch task execution failed');
      }

      console.error(chalk.red('❌ Failed to execute tasks with single PR:'), error);
      throw error;
    } finally {
      // Switch back to original directory and clean up worktree
      if (this.gitManager && worktreePath && branchName) {
        this.gitManager.switchToOriginalDir();
        await this.gitManager.removeWorktree(branchName);
      }
    }
  }

  async executeNonInteractiveWorkflow(config: NonInteractiveConfig): Promise<void> {
    try {
      console.log(chalk.blue.bold('🚀 Starting non-interactive workflow'));
      console.log('');

      console.log(chalk.blue('🔍 Validating dependencies...'));
      await this.getClaudeExecutor().validateClaudeCodeInstallation();
      console.log(chalk.green('✅ Claude Code SDK configured'));

      this.workingDir = await this.repositoryManager.getValidWorkingDirectory();
      this.gitManager = new GitManager(this.workingDir);

      if (!this.gitManager) {
        throw new Error('GitManager not initialized');
      }
      this.gitManager.validateGitHubCliInstallation();
      console.log(chalk.green('✅ GitHub CLI is installed'));

      if (!this.gitManager) {
        throw new Error('GitManager not initialized');
      }
      this.gitManager.validateGitHubCliAuthentication();
      console.log(chalk.green('✅ GitHub CLI is authenticated'));

      const repoInfo = this.repositoryManager.getRepositoryInfo(this.workingDir);
      console.log(chalk.blue(`📂 Working in: ${repoInfo.name} (${repoInfo.branch})`));
      console.log('');

      // Load repository-specific instructions
      this.repoInstructions = await this.configManager.getRepoInstructions(this.workingDir);
      if (this.repoInstructions) {
        console.log(chalk.green('✅ Repository-specific instructions loaded'));
      }

      // Process tasks based on config
      let finalTasks = config.tasks;
      const prStrategy = config.prStrategy || 'multiple';

      // If single task and generateSubtasks is true, break it down
      if (config.tasks.length === 1 && config.generateSubtasks) {
        console.log(chalk.blue('🔍 Generating subtasks...'));
        finalTasks = await this.jobManager.generateTaskBreakdownWithClaude(config.tasks[0], this.workingDir);
        console.log(chalk.green(`✅ Generated ${finalTasks.length} subtasks`));
      }

      // Create job and tasks
      const jobDescription = config.tasks.length === 1 ? config.tasks[0] : `Multiple tasks: ${config.tasks.slice(0, 2).join(', ')}${config.tasks.length > 2 ? '...' : ''}`;
      const jobUuid = await this.jobManager.createJob(jobDescription, this.workingDir);
      const tasks: Task[] = [];

      for (const taskDescription of finalTasks) {
        const taskUuid = await this.jobManager.createTask(jobUuid, taskDescription, 'build');
        const task = await this.jobManager.getTask(taskUuid);
        if (task) {
          tasks.push(task);
        }
      }

      console.log('');
      console.log(chalk.blue.bold(`📋 Executing ${tasks.length} task(s)...`));

      const shouldWaitForComments = config.waitForComments || false;

      // Execute tasks based on PR strategy
      if (prStrategy === 'single' && tasks.length > 1) {
        await this.executeTasksWithSinglePR(tasks, false);
      } else {
        for (const task of tasks) {
          await this.executeTask(task);
        }
      }

      console.log('');
      console.log(chalk.green.bold('🎉 All initial tasks completed successfully!'));

      // Collect PR URLs
      const createdPRUrls: string[] = [];
      for (const task of tasks) {
        const updatedTask = await this.jobManager.getTask(task.uuid);
        if (updatedTask && updatedTask.pr_link) {
          createdPRUrls.push(updatedTask.pr_link);
        }
      }

      if (createdPRUrls.length > 0) {
        console.log('');
        console.log(chalk.blue('📋 PRs created:'));
        createdPRUrls.forEach(url => console.log(chalk.cyan(`  - ${url}`)));

        if (shouldWaitForComments) {
          // Wait 30 minutes for reviewers to comment
          console.log('');
          console.log(chalk.blue('⏰ Waiting 30 minutes for PR reviews...'));
          console.log(chalk.gray('PRs being monitored:'));
          createdPRUrls.forEach(url => console.log(chalk.gray(`  - ${url}`)));
          console.log('');

          const waitTime = 30 * 60 * 1000; // 30 minutes in milliseconds
          const startTime = Date.now();
          const interval = setInterval(() => {
            const elapsed = Date.now() - startTime;
            const remaining = waitTime - elapsed;
            const minutes = Math.floor(remaining / 60000);
            const seconds = Math.floor((remaining % 60000) / 1000);
            process.stdout.write(`\r${chalk.blue('⏰')} Time remaining: ${minutes}:${seconds.toString().padStart(2, '0')}  `);
          }, 1000);

          await new Promise(resolve => setTimeout(resolve, waitTime));
          clearInterval(interval);
          console.log('\n');

          // Check for unaddressed comments on created PRs
          console.log(chalk.blue('🔍 Checking for PR review comments...'));
          const prService = new PRService(this.workingDir);
          const addressTasks = await this.checkAndCreateAddressTasks(createdPRUrls, prService);

          if (addressTasks.length > 0) {
            console.log('');
            console.log(chalk.blue.bold(`📋 Found ${addressTasks.length} comments to address`));

            // Execute address tasks automatically
            const addressExecutor = new AddressTaskExecutor();
            await addressExecutor.executeAddressTasks(addressTasks);

            console.log('');
            console.log(chalk.green.bold('🎉 All PR comments addressed successfully!'));
          } else {
            console.log(chalk.green('✨ No unaddressed comments found on PRs!'));
          }
        }
      }

    } catch (error) {
      console.error(chalk.red.bold('❌ Non-interactive workflow failed:'), error);
      throw error;
    } finally {
      this.jobManager.close();
    }
  }

  private formatMemoriesForPrompt(memories: Array<{
    commentText: string;
    filePath: string | null;
    prDescription: string;
    commentAuthor: string;
    relevantChunk: string;
  }>): string {
    let prompt = '=== Relevant Past Learnings ===\n';
    prompt += 'Similar situations I\'ve handled before:\n\n';

    memories.forEach((memory, i) => {
      prompt += `${i + 1}. Context: ${memory.prDescription}\n`;
      prompt += `   Comment from @${memory.commentAuthor}: "${memory.commentText}"\n`;
      if (memory.filePath) {
        prompt += `   File: ${memory.filePath}\n`;
      }
      prompt += `   Learning: ${memory.relevantChunk}\n\n`;
    });

    prompt += '=== End of Past Learnings ===\n';
    return prompt;
  }
}

