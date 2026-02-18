import chalk from 'chalk';
import ora from 'ora';
import type { Ora } from 'ora';
import { execSync } from 'child_process';
import { JobManager } from './job-manager.js';
import { ExecutorFactory, IClaudeExecutor } from './executor-factory.js';
import { OpenAIService } from './openai-service.js';
import { ConfigManager } from '../config.js';
import { Task } from '../database.js';
import { IGitManager, IPRService } from './git-interfaces.js';
import { createGitManager, createPRService } from './service-factory.js';
import { GitHubAPIClient } from './github-api-client.js';

export class AddressTaskExecutor {
  private jobManager: JobManager;
  private gitManager: IGitManager | null = null;
  private claudeExecutor: IClaudeExecutor | null = null;
  private openaiService: OpenAIService | null = null;
  private configManager: ConfigManager;
  private prService: IPRService | null = null;
  private workingDir: string;
  private repoInstructions: string | undefined;
  private githubClient: GitHubAPIClient | null = null;
  private repoOwner: string = '';
  private repoName: string = '';

  constructor() {
    this.jobManager = new JobManager();
    this.configManager = new ConfigManager();
    this.workingDir = '';
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

  async executeAddressTasks(tasks: Task[], quiet: boolean = false): Promise<void> {
    try {
      if (!quiet) {
        console.log(chalk.blue.bold('🚀 Starting address task workflow'));
        console.log('');
      }

      // Validate dependencies
      await this.getClaudeExecutor().validateClaudeCodeInstallation();
      if (!quiet) console.log(chalk.green('✅ Claude Code SDK configured'));

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
      this.gitManager = createGitManager(this.workingDir);
      this.prService = createPRService(this.workingDir);

      this.gitManager.validateGitHubCliInstallation();
      if (!quiet) console.log(chalk.green('✅ GitHub CLI is installed'));

      this.gitManager.validateGitHubCliAuthentication();
      if (!quiet) console.log(chalk.green('✅ GitHub CLI is authenticated'));

      // Initialize GitHub API client if using PAT
      const authType = this.configManager.getGithubAuthType();
      if (authType === 'pat') {
        const pat = this.configManager.getGithubPat();
        if (pat) {
          this.githubClient = new GitHubAPIClient(pat);
          const repoInfo = GitHubAPIClient.getRepoInfoFromRemote(this.workingDir);
          this.repoOwner = repoInfo.owner;
          this.repoName = repoInfo.repo;
        }
      }

      // If not using PAT, get repo info from gh command
      if (!this.githubClient) {
        try {
          const repoInfo = execSync('gh repo view --json owner,name', {
            cwd: this.workingDir,
            encoding: 'utf-8'
          });
          const parsed = JSON.parse(repoInfo);
          this.repoOwner = parsed.owner.login;
          this.repoName = parsed.name;
        } catch {
          if (!quiet) console.log(chalk.yellow('⚠️  Could not get repository info'));
        }
      }

      // Load repository instructions
      this.repoInstructions = await this.configManager.getRepoInstructions(this.workingDir);

      // Group tasks by branch
      const tasksByBranch = new Map<string, Task[]>();
      for (const task of tasks) {
        const branch = task.branch || 'unknown';
        if (!tasksByBranch.has(branch)) {
          tasksByBranch.set(branch, []);
        }
        const tasks = tasksByBranch.get(branch);
        if (tasks) {
          tasks.push(task);
        }
      }

      // Execute tasks grouped by branch
      for (const [branch, branchTasks] of tasksByBranch) {
        if (branch === 'unknown') {
          if (!quiet) console.log(chalk.yellow('⚠️  Skipping tasks without branch information'));
          continue;
        }

        if (!quiet) {
          console.log('');
          console.log(chalk.cyan.bold(`🔄 Creating worktree for branch: ${branch}`));
        }

        let spinner = quiet ? null : ora('Creating worktree...').start();
        let worktreePath: string | null = null;

        try {
          // Create worktree for the branch
          if (!this.gitManager) {
            throw new Error('GitManager not initialized');
          }
          worktreePath = await this.gitManager.createWorktree(branch);
          this.gitManager.switchToWorktree(worktreePath);
          if (spinner) spinner.succeed(`Worktree created: ${worktreePath}`);
        } catch (error) {
          if (spinner) spinner.fail(`Failed to create worktree for branch: ${branch}`);
          if (!quiet) console.error(error);
          continue;
        }

        // Handle lint_and_test tasks separately
        const lintAndTestTasks = branchTasks.filter(t => t.type === 'lint_and_test');
        const addressTasks = branchTasks.filter(t => t.type === 'address');

        // Process lint_and_test tasks first
        for (const task of lintAndTestTasks) {
          if (!quiet) {
            console.log('');
            console.log(chalk.blue('🔧 Fixing test and lint failures'));
          }

          await this.jobManager.updateTaskStatus(task.uuid, 'active');

          // Extract PR number from task description
          const prNumberMatch = task.description.match(/PR #(\d+)/);
          const taskPrNumber = prNumberMatch ? parseInt(prNumberMatch[1]) : null;

          if (!quiet) spinner = ora('Fetching GitHub Actions logs...').start();

          let actionLogs = '';
          if (taskPrNumber && this.prService) {
            try {
              actionLogs = await this.prService.getFailingActionLogs(taskPrNumber);
              if (spinner) {
                if (actionLogs) {
                  spinner.succeed('GitHub Actions logs fetched');
                } else {
                  spinner.info('No failing action logs found');
                }
              }
            } catch (error) {
              if (spinner) spinner.warn('Could not fetch GitHub Actions logs');
              if (!quiet) console.error(error);
            }
          }

          if (!quiet) spinner = ora('Running Claude Code to fix test and lint failures...').start();

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
            const result = await this.getClaudeExecutor().executeTask(prompt, worktreePath || this.workingDir);
            if (spinner) spinner.succeed('Claude Code execution completed');

            await this.jobManager.updateTaskExecutionLog(task.uuid, result.log);

            if (!this.gitManager) {
              throw new Error('GitManager not initialized');
            }
            const changedFiles = this.gitManager.getChangedFiles();
            if (changedFiles.length === 0) {
              if (!quiet) console.log(chalk.yellow('⚠️  No changes made'));
              await this.jobManager.updateTaskStatus(task.uuid, 'completed');
              continue;
            }

            // Create commit with co-author
            if (!quiet) spinner = ora('Creating commit...').start();
            const commitMessage = 'Fix test and lint failures\n\nCo-authored-by: ivan-agent <ivan-agent@users.noreply.github.com>';

            if (!this.gitManager) {
              throw new Error('GitManager not initialized');
            }

            // Try to commit, handling pre-commit hook failures
            const commitResult = await this.tryCommitWithFixes(
              commitMessage,
              task,
              worktreePath || this.workingDir,
              spinner,
              quiet
            );

            if (commitResult.succeeded) {
              if (spinner) spinner.succeed('Changes committed');
            } else {
              if (spinner) spinner.fail('Failed to commit after multiple attempts');
              throw new Error('Pre-commit hook failures could not be fixed');
            }

            // Get the commit hash
            const commitHash = execSync('git rev-parse HEAD', {
              cwd: worktreePath || this.workingDir,
              encoding: 'utf-8'
            }).trim();

            // Save commit hash to task
            await this.jobManager.updateTaskCommit(task.uuid, commitHash);

            // Push the commit immediately
            if (!quiet) spinner = ora('Pushing commit...').start();
            try {
              if (!this.gitManager) {
                throw new Error('GitManager not initialized');
              }
              await this.gitManager.pushBranch(branch);
              if (spinner) spinner.succeed('Commit pushed successfully');
            } catch (error) {
              if (spinner) spinner.fail('Failed to push commit');
              if (!quiet) console.error(error);
            }

            // Add review comment for lint_and_test task
            if (taskPrNumber) {
              if (!quiet) spinner = ora('Adding review request comment...').start();
              try {
                const reviewAgent = this.configManager.getReviewAgent();
                const reviewComment = `${reviewAgent} please review the test and lint fixes that were applied to address the failing CI checks`;

                // Use GitHub API client if available, otherwise fall back to gh command
                if (this.githubClient && this.repoOwner && this.repoName) {
                  await this.githubClient.addPRComment(this.repoOwner, this.repoName, taskPrNumber, reviewComment);
                } else {
                  execSync(
                    `gh pr comment ${taskPrNumber} --body "${reviewComment}"`,
                    {
                      cwd: worktreePath || this.workingDir,
                      stdio: 'pipe'
                    }
                  );
                }
                if (spinner) spinner.succeed('Review request comment added');
              } catch (error) {
                if (spinner) spinner.fail('Failed to add review comment');
                if (!quiet) console.error(error);
              }
            }

            await this.jobManager.updateTaskStatus(task.uuid, 'completed');

          } catch (error) {
            if (spinner) spinner.fail('Failed to fix test and lint failures');
            if (!quiet) console.error(error);

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

        // Process each address task directly (no need to re-fetch comments from GitHub)
        for (const task of addressTasks) {
          // Skip tasks that aren't comment-related
          if (!task.description.includes('comment from @')) {
            continue;
          }

          // Parse comment information from task description
          // Format: "Address PR #123 comment from @author: "body" (in path:line)"
          const authorMatch = task.description.match(/comment from @(\w+)/);
          const bodyMatch = task.description.match(/: "(.+?)"/);
          const pathMatch = task.description.match(/\(in (.+?)(:\d+)?\)$/);
          const lineMatch = task.description.match(/:(\d+)\)$/);

          if (!authorMatch || !bodyMatch) {
            if (!quiet) console.log(chalk.yellow(`⚠️  Could not parse comment from task: ${task.description}`));
            continue;
          }

          const comment = {
            author: authorMatch[1],
            body: bodyMatch[1],
            path: pathMatch ? pathMatch[1] : undefined,
            line: lineMatch ? parseInt(lineMatch[1]) : undefined,
            id: '' // We'll fetch this if needed for replying
          };

          // Output what we're addressing
          console.log('');
          console.log(chalk.blue(`📝 Addressing comment from @${comment.author}:`));
          console.log(chalk.gray(`   "${comment.body}"`));
          if (comment.path) {
            console.log(chalk.gray(`   File: ${comment.path}${comment.line ? `:${comment.line}` : ''}`));
          }

          await this.jobManager.updateTaskStatus(task.uuid, 'active');

          // Fetch the comment ID from GitHub for replying later
          if (prNumber) {
            const commentId = await this.findCommentId(
              parseInt(prNumber),
              comment.author,
              comment.body.substring(0, 50),
              comment.path,
              comment.line
            );
            if (commentId) {
              comment.id = commentId;
              // Save comment URL
              if (this.repoOwner && this.repoName) {
                const commentUrl = `https://github.com/${this.repoOwner}/${this.repoName}/pull/${prNumber}#discussion_r${commentId}`;
                await this.jobManager.updateTaskCommentUrl(task.uuid, commentUrl);
              }
            }
          }

          if (!quiet) spinner = ora('Running Claude Code to address comment...').start();

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
            const result = await this.getClaudeExecutor().executeTask(prompt, worktreePath || this.workingDir);
            if (spinner) {
              spinner.succeed('Claude Code execution completed');
            }
            // Always output the final message from Claude (even in quiet mode)
            console.log(result.lastMessage);

            await this.jobManager.updateTaskExecutionLog(task.uuid, result.log);

            // Use the last message from Claude's response
            const lastMessage = result.lastMessage;

            if (!this.gitManager) {
              throw new Error('GitManager not initialized');
            }
            const changedFiles = this.gitManager.getChangedFiles();
            if (changedFiles.length === 0) {
              if (!quiet) console.log(chalk.yellow('⚠️  No changes made - Claude determined no changes were needed'));

              // Reply to the comment explaining why no changes were made
              if (!quiet) spinner = ora('Replying to comment...').start();
              try {
                // Truncate the message if it's too long (GitHub has a 65536 character limit)
                const maxLength = 60000;
                let replyBody = `Ivan: ${lastMessage || 'After reviewing, no code changes were necessary to address this comment.'}`;

                if (replyBody.length > maxLength) {
                  replyBody = replyBody.substring(0, maxLength) + '\n\n... (message truncated)';
                }

                // Use GitHub API client if available, otherwise fall back to gh command
                if (this.githubClient && this.repoOwner && this.repoName && prNumber) {
                  await this.githubClient.addReviewThreadReply(
                    this.repoOwner,
                    this.repoName,
                    parseInt(prNumber),
                    comment.id,
                    replyBody
                  );
                  if (spinner) spinner.succeed('Reply added to comment');
                } else {
                  // Fallback to gh command
                  const { writeFileSync, unlinkSync } = await import('fs');
                  const { join } = await import('path');
                  const { tmpdir } = await import('os');
                  const tempFile = join(tmpdir(), `ivan-comment-${Date.now()}.txt`);

                  writeFileSync(tempFile, replyBody);

                  try {
                    const repoInfo = execSync(
                      'gh repo view --json owner,name',
                      {
                        cwd: worktreePath || this.workingDir,
                        encoding: 'utf-8'
                      }
                    );
                    const { owner, name: repoName } = JSON.parse(repoInfo);

                    const threadQuery = `
                      query {
                        repository(owner: "${owner.login}", name: "${repoName}") {
                          pullRequest(number: ${prNumber}) {
                            reviewThreads(first: 100) {
                              nodes {
                                id
                                comments(first: 100) {
                                  nodes {
                                    databaseId
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    `;

                    const threadResult = execSync(
                      `gh api graphql -f query='${threadQuery.replace(/'/g, "'\\''")}'`,
                      {
                        cwd: worktreePath || this.workingDir,
                        encoding: 'utf-8'
                      }
                    );

                    const threadData = JSON.parse(threadResult);
                    const threads = threadData.data?.repository?.pullRequest?.reviewThreads?.nodes || [];

                    let threadId = null;
                    for (const thread of threads) {
                      const comments = thread.comments?.nodes || [];
                      if (comments.some((c: { databaseId?: number }) => c.databaseId?.toString() === comment.id)) {
                        threadId = thread.id;
                        break;
                      }
                    }

                    if (!threadId) {
                      throw new Error('Could not find review thread for comment');
                    }

                    const mutation = `
                      mutation {
                        addPullRequestReviewThreadReply(input: {
                          pullRequestReviewThreadId: "${threadId}"
                          body: ${JSON.stringify(replyBody)}
                        }) {
                          comment {
                            id
                          }
                        }
                      }
                    `;

                    execSync(
                      `gh api graphql -f query='${mutation.replace(/'/g, "'\\''")}'`,
                      {
                        cwd: worktreePath || this.workingDir,
                        stdio: 'pipe'
                      }
                    );
                    if (spinner) spinner.succeed('Reply added to comment');
                  } finally {
                    unlinkSync(tempFile);
                  }
                }
              } catch (error) {
                if (spinner) spinner.fail('Failed to reply to comment');
                if (!quiet) console.error(error);
              }

              await this.jobManager.updateTaskStatus(task.uuid, 'completed');
              continue;
            }

            // Create commit with co-author
            if (!quiet) spinner = ora('Creating commit...').start();
            const commitMessage = `Address review comment from @${comment.author}

${comment.body.substring(0, 200)}${comment.body.length > 200 ? '...' : ''}

Co-authored-by: ivan-agent <ivan-agent@users.noreply.github.com}`;

            if (!this.gitManager) {
              throw new Error('GitManager not initialized');
            }

            // Try to commit, handling pre-commit hook failures
            const commitResult = await this.tryCommitWithFixes(
              commitMessage,
              task,
              worktreePath || this.workingDir,
              spinner,
              quiet
            );

            if (commitResult.succeeded) {
              if (spinner) spinner.succeed('Changes committed');
            } else {
              if (spinner) spinner.fail('Failed to commit after multiple attempts');
              throw new Error('Pre-commit hook failures could not be fixed');
            }

            // Get the commit hash
            const commitHash = execSync('git rev-parse HEAD', {
              cwd: worktreePath || this.workingDir,
              encoding: 'utf-8'
            }).trim();

            // Save commit hash to task
            await this.jobManager.updateTaskCommit(task.uuid, commitHash);

            // Push the commit immediately
            if (!quiet) spinner = ora('Pushing commit...').start();
            try {
              if (!this.gitManager) {
                throw new Error('GitManager not initialized');
              }
              await this.gitManager.pushBranch(branch);
              if (spinner) spinner.succeed('Commit pushed successfully');
            } catch (error) {
              if (spinner) spinner.fail('Failed to push commit');
              if (!quiet) console.error(error);
            }

            // Reply to the comment with the fix
            if (!quiet) spinner = ora('Replying to comment...').start();
            try {
              // Truncate the message if it's too long (GitHub has a 65536 character limit)
              const maxLength = 60000;
              let replyBody = lastMessage
                ? `Ivan: ${lastMessage}\n\nThis has been addressed in commit ${commitHash.substring(0, 7)}`
                : `Ivan: This has been addressed in commit ${commitHash.substring(0, 7)}`;

              if (replyBody.length > maxLength) {
                replyBody = replyBody.substring(0, maxLength) + '\n\n... (message truncated)\n\n' +
                  `This has been addressed in commit ${commitHash.substring(0, 7)}`;
              }

              // Use GitHub API client if available, otherwise fall back to gh command
              if (this.githubClient && this.repoOwner && this.repoName && prNumber) {
                await this.githubClient.addReviewThreadReply(
                  this.repoOwner,
                  this.repoName,
                  parseInt(prNumber),
                  comment.id,
                  replyBody
                );
                if (spinner) spinner.succeed('Reply added to comment');
              } else {
                // Fallback to gh command
                const repoInfo = execSync(
                  'gh repo view --json owner,name',
                  {
                    cwd: worktreePath || this.workingDir,
                    encoding: 'utf-8'
                  }
                );
                const { owner, name: repoName } = JSON.parse(repoInfo);

                const threadQuery = `
                  query {
                    repository(owner: "${owner.login}", name: "${repoName}") {
                      pullRequest(number: ${prNumber}) {
                        reviewThreads(first: 100) {
                          nodes {
                            id
                            comments(first: 100) {
                              nodes {
                                databaseId
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                `;

                const threadResult = execSync(
                  `gh api graphql -f query='${threadQuery.replace(/'/g, "'\\''")}'`,
                  {
                    cwd: worktreePath || this.workingDir,
                    encoding: 'utf-8'
                  }
                );

                const threadData = JSON.parse(threadResult);
                const threads = threadData.data?.repository?.pullRequest?.reviewThreads?.nodes || [];

                let threadId = null;
                for (const thread of threads) {
                  const comments = thread.comments?.nodes || [];
                  if (comments.some((c: { databaseId?: number }) => c.databaseId?.toString() === comment.id)) {
                    threadId = thread.id;
                    break;
                  }
                }

                if (!threadId) {
                  throw new Error('Could not find review thread for comment');
                }

                const mutation = `
                  mutation {
                    addPullRequestReviewThreadReply(input: {
                      pullRequestReviewThreadId: "${threadId}"
                      body: ${JSON.stringify(replyBody)}
                    }) {
                      comment {
                        id
                      }
                    }
                  }
                `;

                execSync(
                  `gh api graphql -f query='${mutation.replace(/'/g, "'\\''")}'`,
                  {
                    cwd: worktreePath || this.workingDir,
                    stdio: 'pipe'
                  }
                );
                if (spinner) spinner.succeed('Reply added to comment');
              }
            } catch (error) {
              if (spinner) spinner.fail('Failed to reply to comment');
              if (!quiet) console.error(error);
            }

            await this.jobManager.updateTaskStatus(task.uuid, 'completed');

          } catch (error) {
            if (spinner) spinner.fail('Failed to address comment');
            if (!quiet) console.error(error);

            const errorLog = error instanceof Error ? error.message : String(error);
            await this.jobManager.updateTaskExecutionLog(task.uuid, `ERROR: ${errorLog}`);
            await this.jobManager.updateTaskStatus(task.uuid, 'not_started');
          }
        }

        // Generate and add specific review comment (only if we have a PR number and made changes)
        if (prNumber && (addressTasks.length > 0 || lintAndTestTasks.length > 0)) {
          if (!quiet) spinner = ora('Generating review request...').start();
          try {
            // Get the latest commit changes
            const latestCommit = execSync('git rev-parse HEAD', {
              cwd: worktreePath || this.workingDir,
              encoding: 'utf-8'
            }).trim();

            const commitDiff = execSync(`git show ${latestCommit} --format="" --unified=3`, {
              cwd: worktreePath || this.workingDir,
              encoding: 'utf-8'
            });

            const changedFiles = execSync(`git show --name-only --format="" ${latestCommit}`, {
              cwd: worktreePath || this.workingDir,
              encoding: 'utf-8'
            }).trim().split('\n').filter(Boolean);

            // Generate specific review instructions using OpenAI
            const reviewInstructions = await this.generateReviewInstructions(
              commitDiff,
              changedFiles,
              parseInt(prNumber)
            );

            if (spinner) spinner.succeed('Review request generated');

            // Add the review comment
            if (!quiet) spinner = ora('Adding review request comment...').start();
            const reviewAgent = this.configManager.getReviewAgent();
            const reviewComment = `${reviewAgent} ${reviewInstructions}`;

            // Use GitHub API client if available, otherwise fall back to gh command
            if (this.githubClient && this.repoOwner && this.repoName) {
              await this.githubClient.addPRComment(this.repoOwner, this.repoName, parseInt(prNumber), reviewComment);
            } else {
              execSync(
                `gh pr comment ${prNumber} --body "${reviewComment.replace(/"/g, '\\"')}"`,
                {
                  cwd: worktreePath || this.workingDir,
                  stdio: 'pipe'
                }
              );
            }
            if (spinner) spinner.succeed('Review request comment added');
          } catch (error) {
            if (spinner) spinner.fail('Failed to add review comment');
            if (!quiet) console.error(error);
          }
        }

        // Clean up worktree after processing branch
        if (this.gitManager && worktreePath) {
          try {
            this.gitManager.switchToOriginalDir();
            await this.gitManager.removeWorktree(branch);
          } catch (error) {
            if (!quiet) console.log(chalk.yellow(`⚠️ Could not clean up worktree: ${error}`));
          }
        }
      }

      if (!quiet) {
        console.log('');
        console.log(chalk.green.bold('🎉 All address tasks completed!'));
      }

    } catch (error) {
      if (!quiet) console.error(chalk.red.bold('❌ Address workflow failed:'), error);
      throw error;
    }
  }

  private async getUnaddressedComments(prNumber: number): Promise<Array<{
    id: string;
    author: string;
    body: string;
    createdAt: string;
    path?: string;
    line?: number;
  }>> {
    if (!this.prService) {
      throw new Error('PR service not initialized');
    }

    try {
      return await this.prService.getUnaddressedComments(prNumber);
    } catch (error) {
      console.error('Error fetching comments:', error);
      return [];
    }
  }

  private async findCommentId(prNumber: number, author: string, bodySnippet: string, path?: string, line?: number): Promise<string | null> {
    // Fetch ALL comments (including resolved ones) to find the matching comment
    try {
      // Get repo info if not already set
      let owner = this.repoOwner;
      let repoName = this.repoName;

      if (!owner || !repoName) {
        const repoInfo = execSync('gh repo view --json owner,name', {
          cwd: this.workingDir,
          encoding: 'utf-8'
        });
        const parsed = JSON.parse(repoInfo);
        owner = parsed.owner.login;
        repoName = parsed.name;
      }

      // Use GraphQL to get ALL review threads, not just unresolved ones
      const graphqlQuery = `
        query {
          repository(owner: "${owner}", name: "${repoName}") {
            pullRequest(number: ${prNumber}) {
              reviewThreads(first: 100) {
                nodes {
                  comments(first: 100) {
                    nodes {
                      databaseId
                      body
                      author {
                        login
                      }
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
        `gh api graphql -f query='${graphqlQuery.replace(/'/g, "'\\''")}'`,
        {
          cwd: this.workingDir,
          encoding: 'utf-8'
        }
      );

      const result = JSON.parse(graphqlResult);
      const threads = result.data?.repository?.pullRequest?.reviewThreads?.nodes || [];

      // Search through all comments in all threads
      for (const thread of threads) {
        const comments = thread.comments?.nodes || [];
        for (const comment of comments) {
          if (comment.author?.login === author &&
              comment.body.includes(bodySnippet) &&
              (!path || comment.path === path) &&
              (!line || comment.line === line)) {
            return comment.databaseId ? comment.databaseId.toString() : null;
          }
        }
      }

      return null;
    } catch (error) {
      console.error('Error finding comment ID:', error);
      return null;
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

Return ONLY the review request text, without any prefix like "Please review" since the review agent will already be prepended.`;

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

  private async tryCommitWithFixes(
    commitMessage: string,
    task: Task,
    workingDir: string,
    spinner: Ora | null,
    quiet: boolean = false
  ): Promise<{ succeeded: boolean }> {
    let commitAttempts = 0;
    const maxCommitAttempts = 3;
    let commitSucceeded = false;

    while (commitAttempts < maxCommitAttempts && !commitSucceeded) {
      try {
        if (!this.gitManager) {
          throw new Error('GitManager not initialized');
        }
        await this.gitManager.commitChanges(commitMessage);
        commitSucceeded = true;
        // Stop the spinner if we're retrying
        if (commitAttempts > 0 && spinner && spinner.isSpinning) {
          spinner.succeed('Commit successful after retry');
        }
      } catch (commitError) {
        commitAttempts++;

        const errorMessage = commitError instanceof Error ? commitError.message : String(commitError);

        // Check if this is a pre-commit hook failure
        if (errorMessage.includes('pre-commit') && commitAttempts < maxCommitAttempts) {
          if (spinner) {
            spinner.fail(`Pre-commit hook failed (attempt ${commitAttempts}/${maxCommitAttempts})`);
            console.log(chalk.yellow('🔧 Running Claude to fix pre-commit errors...'));
          }

          // Extract the error details from the commit error
          const errorDetails = errorMessage;

          // Prepare prompt for Claude to fix the errors
          const fixPrompt = `Fix the following pre-commit hook errors:\n\n${errorDetails}\n\nPlease fix all TypeScript errors, linting issues, and any other problems preventing the commit.`;

          if (!quiet) spinner = ora('Running Claude to fix pre-commit errors...').start();

          try {
            // Run Claude to fix the errors
            const fixResult = await this.getClaudeExecutor().executeTask(fixPrompt, workingDir);
            if (spinner) spinner.succeed('Claude attempted to fix the errors');

            // Update the execution log with the fix attempt
            const previousLog = await this.jobManager.getTaskExecutionLog(task.uuid);
            await this.jobManager.updateTaskExecutionLog(
              task.uuid,
              `${previousLog}\n\n--- Pre-commit Fix Attempt ${commitAttempts} ---\n${fixResult.log}`
            );

            // Try to commit again on the next iteration
            if (!quiet) spinner = ora('Retrying commit...').start();
          } catch (fixError) {
            if (spinner) spinner.fail('Failed to run Claude to fix errors');
            if (!quiet) console.error(chalk.red('Claude fix attempt failed:'), fixError);
            throw commitError; // Re-throw the original error
          }
        } else {
          // Not a pre-commit error or max attempts reached
          throw commitError;
        }
      }
    }

    return { succeeded: commitSucceeded };
  }

}

