import { execSync } from 'child_process';
import chalk from 'chalk';
import { IPRService, PullRequest, PRComment } from './git-interfaces.js';
import { GitHubAPIClient } from './github-api-client.js';

export class PRServicePAT implements IPRService {
  private workingDir: string;
  private githubClient: GitHubAPIClient;
  private owner: string;
  private repo: string;

  constructor(workingDir: string, pat: string) {
    this.workingDir = workingDir;
    this.githubClient = new GitHubAPIClient(pat);

    // Get repository info from git remote
    const repoInfo = GitHubAPIClient.getRepoInfoFromRemote(workingDir);
    this.owner = repoInfo.owner;
    this.repo = repoInfo.repo;
  }

  async getSpecificPRWithIssues(prNumber: number): Promise<PullRequest[]> {
    try {
      // Get specific PR
      const pr = await this.githubClient.getPR(this.owner, this.repo, prNumber);

      // Check if PR is open
      // GitHub REST API returns lowercase state: "open", "closed", or "merged"
      if (pr.state.toUpperCase() !== 'OPEN') {
        console.log(chalk.yellow(`⚠️  PR #${prNumber} is not open (status: ${pr.state})`));
        return [];
      }

      const pullRequest: PullRequest = {
        number: pr.number,
        title: pr.title,
        branch: pr.headRefName,
        url: pr.url,
        hasUnaddressedComments: false,
        hasFailingChecks: false,
        unaddressedComments: [],
        failingChecks: [],
        hasTestOrLintFailures: false,
        testOrLintFailures: []
      };

      // Check for unaddressed comments
      const comments = await this.getUnaddressedComments(pr.number);
      if (comments.length > 0) {
        pullRequest.hasUnaddressedComments = true;
        pullRequest.unaddressedComments = comments;
      }

      // Check for failing checks
      const { allFailures, testOrLintFailures } = await this.getFailingChecks(pr.number);
      if (allFailures.length > 0) {
        pullRequest.hasFailingChecks = true;
        pullRequest.failingChecks = allFailures;
      }
      if (testOrLintFailures.length > 0) {
        pullRequest.hasTestOrLintFailures = true;
        pullRequest.testOrLintFailures = testOrLintFailures;
      }

      // Only include PR if it has issues
      if (pullRequest.hasUnaddressedComments || pullRequest.hasFailingChecks) {
        return [pullRequest];
      }

      return [];
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('no pull requests found') || errorMessage.includes('404')) {
        console.error(chalk.red(`❌ PR #${prNumber} not found`));
      } else {
        console.error(chalk.red(`Error fetching PR #${prNumber}:`), error);
      }
      throw error;
    }
  }

  async getOpenPRsWithIssues(fromUser?: string): Promise<PullRequest[]> {
    try {
      // Get all open PRs, optionally filtered by author
      const prs = await this.githubClient.listPRs(this.owner, this.repo, {
        state: 'open',
        author: fromUser
      });

      const pullRequests: PullRequest[] = [];

      for (const pr of prs) {
        const pullRequest: PullRequest = {
          number: pr.number,
          title: pr.title,
          branch: pr.headRefName,
          url: pr.url,
          hasUnaddressedComments: false,
          hasFailingChecks: false,
          unaddressedComments: [],
          failingChecks: [],
          hasTestOrLintFailures: false,
          testOrLintFailures: []
        };

        // Check for unaddressed comments
        const comments = await this.getUnaddressedComments(pr.number);
        if (comments.length > 0) {
          pullRequest.hasUnaddressedComments = true;
          pullRequest.unaddressedComments = comments;
        }

        // Check for failing checks
        const { allFailures, testOrLintFailures } = await this.getFailingChecks(pr.number);
        if (allFailures.length > 0) {
          pullRequest.hasFailingChecks = true;
          pullRequest.failingChecks = allFailures;
        }
        if (testOrLintFailures.length > 0) {
          pullRequest.hasTestOrLintFailures = true;
          pullRequest.testOrLintFailures = testOrLintFailures;
        }

        // Only include PRs that have issues
        if (pullRequest.hasUnaddressedComments || pullRequest.hasFailingChecks) {
          pullRequests.push(pullRequest);
        }
      }

      return pullRequests;
    } catch (error) {
      console.error(chalk.red('Error fetching PRs:'), error);
      throw error;
    }
  }

  async getUnaddressedComments(prNumber: number): Promise<PRComment[]> {
    try {
      // Get review threads using GraphQL
      const threads = await this.githubClient.getReviewThreads(this.owner, this.repo, prNumber);
      const unaddressedComments: PRComment[] = [];

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
    } catch {
      // If there's an error fetching comments, return empty array
      return [];
    }
  }

  private async getFailingChecks(prNumber: number): Promise<{ allFailures: string[], testOrLintFailures: string[] }> {
    try {
      const checks = await this.githubClient.getPRChecks(this.owner, this.repo, prNumber);

      const failingChecks: string[] = [];
      const testOrLintFailures: string[] = [];

      for (const check of checks) {
        if (check.state === 'FAILURE' || check.state === 'ERROR') {
          failingChecks.push(check.name);

          // Check if this is a test or lint failure
          const checkNameLower = check.name.toLowerCase();
          if (
            checkNameLower.includes('test') ||
            checkNameLower.includes('lint') ||
            checkNameLower.includes('eslint') ||
            checkNameLower.includes('prettier') ||
            checkNameLower.includes('jest') ||
            checkNameLower.includes('mocha') ||
            checkNameLower.includes('pytest') ||
            checkNameLower.includes('ruff') ||
            checkNameLower.includes('black') ||
            checkNameLower.includes('flake8') ||
            checkNameLower.includes('mypy') ||
            checkNameLower.includes('typecheck') ||
            checkNameLower.includes('type-check') ||
            checkNameLower.includes('tsc') ||
            checkNameLower.includes('clippy') ||
            checkNameLower.includes('rustfmt')
          ) {
            testOrLintFailures.push(check.name);
          }
        }
      }

      return { allFailures: failingChecks, testOrLintFailures };
    } catch {
      // If there's an error fetching checks, return empty arrays
      return { allFailures: [], testOrLintFailures: [] };
    }
  }

  async checkoutPRBranch(prNumber: number): Promise<void> {
    // For PAT implementation, we need to fetch the PR branch and check it out manually
    try {
      const pr = await this.githubClient.getPR(this.owner, this.repo, prNumber);
      const branchName = pr.headRefName;

      // Fetch the PR branch
      execSync(`git fetch origin ${branchName}:${branchName}`, {
        cwd: this.workingDir,
        stdio: 'inherit'
      });

      // Checkout the branch
      execSync(`git checkout ${branchName}`, {
        cwd: this.workingDir,
        stdio: 'inherit'
      });
    } catch (error) {
      throw new Error(`Failed to checkout PR branch: ${error}`);
    }
  }

  async getFailingActionLogs(prNumber: number): Promise<string> {
    try {
      const checks = await this.githubClient.getPRChecks(this.owner, this.repo, prNumber);
      let failingLogs = '';

      for (const check of checks) {
        if (check.state === 'FAILURE' || check.state === 'ERROR') {
          // Extract run ID from the link
          const runIdMatch = check.link?.match(/\/runs\/(\d+)/);
          if (runIdMatch) {
            const runId = parseInt(runIdMatch[1], 10);

            try {
              // Get the failed logs for this run
              const logs = await this.githubClient.getWorkflowRunLogs(this.owner, this.repo, runId);

              if (logs) {
                failingLogs += `\n\n=== Failed logs for ${check.name} ===\n`;
                // Truncate logs if too large (keep last 5000 chars per check)
                if (logs.length > 5000) {
                  failingLogs += '... (truncated) ...\n';
                  failingLogs += logs.substring(logs.length - 5000);
                } else {
                  failingLogs += logs;
                }
              }
            } catch (error) {
              console.error(`Failed to get logs for run ${runId}:`, error);
            }
          }
        }
      }

      return failingLogs;
    } catch (error) {
      console.error('Error fetching action logs:', error);
      return '';
    }
  }
}
