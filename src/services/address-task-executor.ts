import chalk from 'chalk';
import ora from 'ora';
import { execSync } from 'child_process';
import { JobManager } from './job-manager.js';
import { GitManager } from './git-manager.js';
import { ClaudeExecutor } from './claude-executor.js';
import { ConfigManager } from '../config.js';
import { Task } from '../database.js';

export class AddressTaskExecutor {
  private jobManager: JobManager;
  private gitManager: GitManager | null = null;
  private claudeExecutor: ClaudeExecutor | null = null;
  private configManager: ConfigManager;
  private workingDir: string;
  private repoInstructions: string | undefined;

  constructor() {
    this.jobManager = new JobManager();
    this.configManager = new ConfigManager();
    this.workingDir = '';
  }

  private getClaudeExecutor(): ClaudeExecutor {
    if (!this.claudeExecutor) {
      this.claudeExecutor = new ClaudeExecutor();
    }
    return this.claudeExecutor;
  }

  async executeAddressTasks(tasks: Task[]): Promise<void> {
    try {
      console.log(chalk.blue.bold('🚀 Starting address task workflow'));
      console.log('');

      // Validate dependencies
      await this.getClaudeExecutor().validateClaudeCodeInstallation();
      console.log(chalk.green('✅ Claude Code SDK configured'));

      // Get working directory from first task's job
      const db = this.jobManager['dbManager'].getKysely();
      const job = await db
        .selectFrom('jobs')
        .selectAll()
        .where('uuid', '=', tasks[0].job_uuid)
        .executeTakeFirst();

      if (!job) {
        throw new Error('Job not found');
      }

      this.workingDir = job.directory;
      this.gitManager = new GitManager(this.workingDir);

      this.gitManager.validateGitHubCliInstallation();
      console.log(chalk.green('✅ GitHub CLI is installed'));

      this.gitManager.validateGitHubCliAuthentication();
      console.log(chalk.green('✅ GitHub CLI is authenticated'));

      // Load repository instructions
      this.repoInstructions = await this.configManager.getRepoInstructions(this.workingDir);

      // Group tasks by branch
      const tasksByBranch = new Map<string, Task[]>();
      for (const task of tasks) {
        const branch = task.branch || 'unknown';
        if (!tasksByBranch.has(branch)) {
          tasksByBranch.set(branch, []);
        }
        tasksByBranch.get(branch)!.push(task);
      }

      // Execute tasks grouped by branch
      for (const [branch, branchTasks] of tasksByBranch) {
        if (branch === 'unknown') {
          console.log(chalk.yellow('⚠️  Skipping tasks without branch information'));
          continue;
        }

        console.log('');
        console.log(chalk.cyan.bold(`🔄 Checking out branch: ${branch}`));
        
        let spinner = ora('Checking out branch...').start();
        try {
          // Checkout the branch
          execSync(`git checkout ${branch}`, {
            cwd: this.workingDir,
            stdio: 'pipe'
          });
          spinner.succeed(`Switched to branch: ${branch}`);
        } catch (error) {
          spinner.fail(`Failed to checkout branch: ${branch}`);
          console.error(error);
          continue;
        }

        // Get PR number from branch name or task description
        const prMatch = branchTasks[0].description.match(/PR #(\d+)/);
        if (!prMatch) {
          console.log(chalk.yellow('⚠️  Could not extract PR number from task'));
          continue;
        }
        const prNumber = prMatch[1];

        // Get all unaddressed comments for this PR
        spinner = ora('Fetching PR comments...').start();
        const comments = await this.getUnaddressedComments(parseInt(prNumber));
        spinner.succeed(`Found ${comments.length} unaddressed comments`);

        if (comments.length === 0) {
          console.log(chalk.yellow('⚠️  No unaddressed comments found'));
          continue;
        }

        // Process each comment
        for (const comment of comments) {
          console.log('');
          console.log(chalk.blue(`📝 Addressing comment from @${comment.author}:`));
          console.log(chalk.gray(`   "${comment.body.substring(0, 100)}${comment.body.length > 100 ? '...' : ''}"`));

          // Find the corresponding task
          const task = branchTasks.find(t => 
            t.description.includes(comment.author) && 
            t.description.includes(comment.body.substring(0, 50))
          );

          if (!task) {
            console.log(chalk.yellow('⚠️  No task found for this comment'));
            continue;
          }

          await this.jobManager.updateTaskStatus(task.uuid, 'active');

          spinner = ora('Running Claude Code to address comment...').start();
          
          // Prepare the prompt for Claude
          let prompt = `Address the following PR review comment:\n\n`;
          prompt += `Comment from @${comment.author}:\n"${comment.body}"\n\n`;
          
          if (comment.path) {
            prompt += `File: ${comment.path}`;
            if (comment.line) {
              prompt += ` (line ${comment.line})`;
            }
            prompt += '\n\n';
          }

          prompt += 'Please make the necessary changes to address this comment.';
          
          if (this.repoInstructions) {
            prompt += `\n\nRepository-specific instructions:\n${this.repoInstructions}`;
          }

          try {
            const executionLog = await this.getClaudeExecutor().executeTask(prompt, this.workingDir);
            spinner.succeed('Claude Code execution completed');

            await this.jobManager.updateTaskExecutionLog(task.uuid, executionLog);

            const changedFiles = this.gitManager!.getChangedFiles();
            if (changedFiles.length === 0) {
              console.log(chalk.yellow('⚠️  No changes made'));
              await this.jobManager.updateTaskStatus(task.uuid, 'completed');
              continue;
            }

            // Create commit with co-author
            spinner = ora('Creating commit...').start();
            const commitMessage = `Address review comment from @${comment.author}

${comment.body.substring(0, 200)}${comment.body.length > 200 ? '...' : ''}

Co-authored-by: ari-agent <ari-agent@users.noreply.github.com>`;

            await this.gitManager!.commitChanges(commitMessage);
            spinner.succeed('Changes committed');

            // Get the commit hash
            const commitHash = execSync('git rev-parse HEAD', {
              cwd: this.workingDir,
              encoding: 'utf-8'
            }).trim();

            // Push the commit immediately
            spinner = ora('Pushing commit...').start();
            try {
              await this.gitManager!.pushBranch(branch);
              spinner.succeed('Commit pushed successfully');
            } catch (error) {
              spinner.fail('Failed to push commit');
              console.error(error);
            }

            // Reply to the comment with the fix
            spinner = ora('Replying to comment...').start();
            try {
              const replyBody = `This has been addressed in commit ${commitHash.substring(0, 7)}`;
              
              // All comments are review comments (inline code comments) now
              execSync(
                `gh api repos/{owner}/{repo}/pulls/${prNumber}/comments/${comment.id}/replies --field body="${replyBody}"`,
                {
                  cwd: this.workingDir,
                  stdio: 'pipe'
                }
              );
              spinner.succeed('Reply added to comment');
            } catch (error) {
              spinner.fail('Failed to reply to comment');
              console.error(error);
            }

            await this.jobManager.updateTaskStatus(task.uuid, 'completed');

          } catch (error) {
            spinner.fail('Failed to address comment');
            console.error(error);
            
            const errorLog = error instanceof Error ? error.message : String(error);
            await this.jobManager.updateTaskExecutionLog(task.uuid, `ERROR: ${errorLog}`);
            await this.jobManager.updateTaskStatus(task.uuid, 'not_started');
          }
        }

        // Add final review comment
        spinner = ora('Adding review request comment...').start();
        try {
          execSync(
            `gh pr comment ${prNumber} --body "@codex please review"`,
            {
              cwd: this.workingDir,
              stdio: 'pipe'
            }
          );
          spinner.succeed('Review request comment added');
        } catch (error) {
          spinner.fail('Failed to add review comment');
          console.error(error);
        }
      }

      console.log('');
      console.log(chalk.green.bold('🎉 All address tasks completed!'));

    } catch (error) {
      console.error(chalk.red.bold('❌ Address workflow failed:'), error);
      throw error;
    }
  }

  private async getUnaddressedComments(prNumber: number): Promise<any[]> {
    try {
      // Get all review comments (inline code comments only)
      const reviewCommentsJson = execSync(
        `gh api repos/{owner}/{repo}/pulls/${prNumber}/comments --paginate`,
        {
          cwd: this.workingDir,
          encoding: 'utf-8'
        }
      );

      const reviewComments = JSON.parse(reviewCommentsJson || '[]');
      const unaddressedComments: any[] = [];

      // Process review comments (inline code comments only)
      for (const comment of reviewComments) {
        // Check if this comment has replies
        if (!comment.in_reply_to_id) {
          // This is a top-level comment, check if it has replies
          const hasReplies = reviewComments.some((c: any) => c.in_reply_to_id === comment.id);
          
          if (!hasReplies) {
            unaddressedComments.push({
              id: comment.id.toString(),
              author: comment.user.login,
              body: comment.body,
              createdAt: comment.created_at,
              path: comment.path,
              line: comment.line || comment.original_line
            });
          }
        }
      }

      return unaddressedComments;
    } catch (error) {
      console.error('Error fetching comments:', error);
      return [];
    }
  }
}