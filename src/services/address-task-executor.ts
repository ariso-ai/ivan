import chalk from 'chalk';
import ora from 'ora';
import { execSync } from 'child_process';
import { JobManager } from './job-manager.js';
import { GitManager } from './git-manager.js';
import { ClaudeExecutor } from './claude-executor.js';
import { OpenAIService } from './openai-service.js';
import { ConfigManager } from '../config.js';
import { Task } from '../database.js';
import { PRService } from './pr-service.js';

export class AddressTaskExecutor {
  private jobManager: JobManager;
  private gitManager: GitManager | null = null;
  private claudeExecutor: ClaudeExecutor | null = null;
  private openaiService: OpenAIService | null = null;
  private configManager: ConfigManager;
  private prService: PRService | null = null;
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

  private getOpenAIService(): OpenAIService {
    if (!this.openaiService) {
      this.openaiService = new OpenAIService();
    }
    return this.openaiService;
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
      this.prService = new PRService(this.workingDir);

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

        // Handle lint_and_test tasks separately
        const lintAndTestTasks = branchTasks.filter(t => t.type === 'lint_and_test');
        const addressTasks = branchTasks.filter(t => t.type === 'address');

        // Process lint_and_test tasks first
        for (const task of lintAndTestTasks) {
          console.log('');
          console.log(chalk.blue('🔧 Fixing test and lint failures'));

          await this.jobManager.updateTaskStatus(task.uuid, 'active');

          // Extract PR number from task description
          const prNumberMatch = task.description.match(/PR #(\d+)/);
          const taskPrNumber = prNumberMatch ? parseInt(prNumberMatch[1]) : null;

          spinner = ora('Fetching GitHub Actions logs...').start();

          let actionLogs = '';
          if (taskPrNumber && this.prService) {
            try {
              actionLogs = await this.prService.getFailingActionLogs(taskPrNumber);
              if (actionLogs) {
                spinner.succeed('GitHub Actions logs fetched');
              } else {
                spinner.info('No failing action logs found');
              }
            } catch (error) {
              spinner.warn('Could not fetch GitHub Actions logs');
              console.error(error);
            }
          }

          spinner = ora('Running Claude Code to fix test and lint failures...').start();

          // Prepare the prompt for Claude
          let prompt = 'Fix the failing tests and linting issues in this PR.\n\n';
          prompt += 'The following GitHub Actions checks are failing:\n';
          prompt += task.description.replace(/^Fix test and lint failures in PR #\d+: /, '') + '\n\n';

          // Include the actual failing logs if available
          if (actionLogs) {
            prompt += '=== GitHub Actions Failure Logs ===\n';
            prompt += actionLogs;
            prompt += '\n=== End of Logs ===\n\n';
          }

          prompt += 'Please run the tests and linting locally, identify what is failing based on the logs above, and fix all issues.';
          prompt += ' Make sure to run the tests again after fixing to verify they pass.';

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
            const commitMessage = 'Fix test and lint failures\n\nCo-authored-by: ivan-agent <ivan-agent@users.noreply.github.com>';

            await this.gitManager!.commitChanges(commitMessage);
            spinner.succeed('Changes committed');

            // Get the commit hash
            const commitHash = execSync('git rev-parse HEAD', {
              cwd: this.workingDir,
              encoding: 'utf-8'
            }).trim();

            // Save commit hash to task
            await this.jobManager.updateTaskCommit(task.uuid, commitHash);

            // Push the commit immediately
            spinner = ora('Pushing commit...').start();
            try {
              await this.gitManager!.pushBranch(branch);
              spinner.succeed('Commit pushed successfully');
            } catch (error) {
              spinner.fail('Failed to push commit');
              console.error(error);
            }

            await this.jobManager.updateTaskStatus(task.uuid, 'completed');

          } catch (error) {
            spinner.fail('Failed to fix test and lint failures');
            console.error(error);

            const errorLog = error instanceof Error ? error.message : String(error);
            await this.jobManager.updateTaskExecutionLog(task.uuid, `ERROR: ${errorLog}`);
            await this.jobManager.updateTaskStatus(task.uuid, 'not_started');
          }
        }

        // Get PR number from branch name or task description
        const prMatch = branchTasks[0].description.match(/PR #(\d+)/);
        if (!prMatch && addressTasks.length > 0) {
          console.log(chalk.yellow('⚠️  Could not extract PR number from task'));
          continue;
        }
        const prNumber = prMatch ? prMatch[1] : null;

        // Skip comment processing if there are no address tasks
        if (addressTasks.length === 0) {
          continue;
        }

        // Get all unaddressed comments for this PR
        spinner = ora('Fetching PR comments...').start();
        const comments = await this.getUnaddressedComments(parseInt(prNumber!));
        spinner.succeed(`Found ${comments.length} unaddressed comments`);

        if (comments.length === 0 && addressTasks.some(t => t.description.includes('comment'))) {
          console.log(chalk.yellow('⚠️  No unaddressed comments found'));
          continue;
        }

        // Process each comment
        for (const comment of comments) {
          console.log('');
          console.log(chalk.blue(`📝 Addressing comment from @${comment.author}:`));
          console.log(chalk.gray(`   "${comment.body.substring(0, 100)}${comment.body.length > 100 ? '...' : ''}"`));

          // Find the corresponding task
          const task = addressTasks.find(t =>
            t.description.includes(comment.author) &&
            t.description.includes(comment.body.substring(0, 50))
          );

          if (!task) {
            console.log(chalk.yellow('⚠️  No task found for this comment'));
            continue;
          }

          await this.jobManager.updateTaskStatus(task.uuid, 'active');

          // Save comment URL
          if (comment.id) {
            const repoInfo = execSync(
              'gh repo view --json owner,name',
              {
                cwd: this.workingDir,
                encoding: 'utf-8'
              }
            );
            const { owner, name: repoName } = JSON.parse(repoInfo);
            const commentUrl = `https://github.com/${owner.login}/${repoName}/pull/${prNumber!}#discussion_r${comment.id}`;
            await this.jobManager.updateTaskCommentUrl(task.uuid, commentUrl);
          }

          spinner = ora('Running Claude Code to address comment...').start();

          // Prepare the prompt for Claude
          let prompt = 'Address the following PR review comment:\n\n';
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

Co-authored-by: ivan-agent <ivan-agent@users.noreply.github.com>`;

            await this.gitManager!.commitChanges(commitMessage);
            spinner.succeed('Changes committed');

            // Get the commit hash
            const commitHash = execSync('git rev-parse HEAD', {
              cwd: this.workingDir,
              encoding: 'utf-8'
            }).trim();

            // Save commit hash to task
            await this.jobManager.updateTaskCommit(task.uuid, commitHash);

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
              const replyBody = `Ivan: This has been addressed in commit ${commitHash.substring(0, 7)}`;

              // All comments are review comments (inline code comments) now
              execSync(
                `gh api repos/{owner}/{repo}/pulls/${prNumber!}/comments/${comment.id}/replies --field body="${replyBody}"`,
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

        // Generate and add specific review comment (only if we have a PR number and made changes)
        if (prNumber && (addressTasks.length > 0 || lintAndTestTasks.length > 0)) {
          spinner = ora('Generating review request...').start();
          try {
            // Get the latest commit changes
            const latestCommit = execSync('git rev-parse HEAD', {
              cwd: this.workingDir,
              encoding: 'utf-8'
            }).trim();

            const commitDiff = execSync(`git show ${latestCommit} --format="" --unified=3`, {
              cwd: this.workingDir,
              encoding: 'utf-8'
            });

            const changedFiles = execSync(`git show --name-only --format="" ${latestCommit}`, {
              cwd: this.workingDir,
              encoding: 'utf-8'
            }).trim().split('\n').filter(Boolean);

            // Generate specific review instructions using OpenAI
            const reviewInstructions = await this.generateReviewInstructions(
              commitDiff,
              changedFiles,
              parseInt(prNumber)
            );

            spinner.succeed('Review request generated');

            // Add the review comment
            spinner = ora('Adding review request comment...').start();
            const reviewComment = `@codex ${reviewInstructions}`;

            execSync(
              `gh pr comment ${prNumber} --body "${reviewComment.replace(/"/g, '\\"')}"`,
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
      // Get PR owner and repo name
      const repoInfo = execSync(
        'gh repo view --json owner,name',
        {
          cwd: this.workingDir,
          encoding: 'utf-8'
        }
      );
      const { owner, name: repoName } = JSON.parse(repoInfo);

      // Use GraphQL to get review threads with resolved status
      const graphqlQuery = `
        query {
          repository(owner: "${owner.login}", name: "${repoName}") {
            pullRequest(number: ${prNumber}) {
              reviewThreads(first: 100) {
                nodes {
                  isResolved
                  comments(first: 100) {
                    nodes {
                      id
                      databaseId
                      body
                      author {
                        login
                      }
                      createdAt
                      path
                      line
                    }
                  }
                }
              }
            }
          }
        }
      `;

      const graphqlResult = execSync(
        `gh api graphql -f query='${graphqlQuery}'`,
        {
          cwd: this.workingDir,
          encoding: 'utf-8'
        }
      );

      const result = JSON.parse(graphqlResult);
      const threads = result.data?.repository?.pullRequest?.reviewThreads?.nodes || [];
      const unaddressedComments: any[] = [];

      // Process each thread
      for (const thread of threads) {
        // Skip resolved threads
        if (thread.isResolved) {
          continue;
        }

        const comments = thread.comments?.nodes || [];
        if (comments.length === 0) {
          continue;
        }

        // Get the first comment (the main review comment)
        const firstComment = comments[0];

        // Check if there are replies (more than one comment in thread)
        const hasReplies = comments.length > 1;

        if (!hasReplies && firstComment.path) {
          // Only include if it's an inline code comment (has a path) and has no replies
          unaddressedComments.push({
            id: firstComment.databaseId ? firstComment.databaseId.toString() : firstComment.id,
            author: firstComment.author.login,
            body: firstComment.body,
            createdAt: firstComment.createdAt,
            path: firstComment.path,
            line: firstComment.line
          });
        }
      }

      return unaddressedComments;
    } catch (error) {
      console.error('Error fetching comments:', error);
      return [];
    }
  }

  private async generateReviewInstructions(
    diff: string,
    changedFiles: string[],
    _prNumber: number
  ): Promise<string> {
    try {
      const openaiService = this.getOpenAIService();
      const client = await openaiService.getClient();

      const prompt = `You are reviewing code changes that were made to address PR review comments. 
Based on the following diff and changed files, generate a concise, specific review request that tells the reviewer what to focus on.

Changed files:
${changedFiles.join('\n')}

Diff (last commit):
${diff.substring(0, 8000)}${diff.length > 8000 ? '\n... (diff truncated)' : ''}

Generate a brief (1-2 sentences) review request that:
1. Mentions the key changes made
2. Asks the reviewer to verify specific aspects that were addressed
3. Is conversational and clear

Example format: "please review the updates to the reflection service integration and verify that the null checks properly handle missing configuration objects"

Return ONLY the review request text, without any prefix like "Please review" since @codex will already be prepended.`;

      const completion = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant that generates specific code review requests based on git diffs.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 150
      });

      const reviewRequest = completion.choices[0]?.message?.content?.trim();

      if (!reviewRequest) {
        return 'please review the latest changes and verify all review comments have been properly addressed';
      }

      return reviewRequest;
    } catch (error) {
      console.error('Error generating review instructions:', error);
      // Fallback to a generic message if OpenAI fails
      return 'please review the latest changes and verify all review comments have been properly addressed';
    }
  }
}

