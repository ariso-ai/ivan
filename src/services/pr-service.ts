import { execSync } from 'child_process';
import chalk from 'chalk';

export interface PullRequest {
  number: number;
  title: string;
  branch: string;
  url: string;
  hasUnaddressedComments: boolean;
  hasFailingChecks: boolean;
  unaddressedComments: PRComment[];
  failingChecks: string[];
  hasTestOrLintFailures: boolean;
  testOrLintFailures: string[];
}

export interface PRComment {
  id: string;
  author: string;
  body: string;
  createdAt: string;
  path?: string;
  line?: number;
}

export class PRService {
  private workingDir: string;

  constructor(workingDir: string) {
    this.workingDir = workingDir;
  }

  async getSpecificPRWithIssues(prNumber: number): Promise<PullRequest[]> {
    try {
      // Get specific PR
      const prJson = execSync(`gh pr view ${prNumber} --json number,title,headRefName,url,state`, {
        cwd: this.workingDir,
        encoding: 'utf-8'
      });

      const pr = JSON.parse(prJson);

      // Check if PR is open
      if (pr.state !== 'OPEN') {
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
      if (errorMessage.includes('no pull requests found')) {
        console.error(chalk.red(`❌ PR #${prNumber} not found`));
      } else {
        console.error(chalk.red(`Error fetching PR #${prNumber}:`), error);
      }
      throw error;
    }
  }

  async getOpenPRsWithIssues(): Promise<PullRequest[]> {
    try {
      // Get all open PRs
      const prsJson = execSync('gh pr list --state open --json number,title,headRefName,url', {
        cwd: this.workingDir,
        encoding: 'utf-8'
      });

      const prs = JSON.parse(prsJson);
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
      const checksJson = execSync(
        `gh pr checks ${prNumber} --json name,state`,
        {
          cwd: this.workingDir,
          encoding: 'utf-8'
        }
      );

      const checks = JSON.parse(checksJson);
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
    execSync(`gh pr checkout ${prNumber}`, {
      cwd: this.workingDir,
      stdio: 'inherit'
    });
  }

  async getFailingActionLogs(prNumber: number): Promise<string> {
    try {
      // Get the checks with their workflow information
      const checksJson = execSync(
        `gh pr checks ${prNumber} --json name,state,link,workflow`,
        {
          cwd: this.workingDir,
          encoding: 'utf-8'
        }
      );

      const checks = JSON.parse(checksJson);
      let failingLogs = '';

      for (const check of checks) {
        if (check.state === 'FAILURE' || check.state === 'ERROR') {
          // Extract run ID from the link (format: https://github.com/owner/repo/actions/runs/123456789/job/987654321)
          const runIdMatch = check.link?.match(/\/runs\/(\d+)/);
          if (runIdMatch) {
            const runId = runIdMatch[1];

            try {
              // Get the failed logs for this run
              const logs = execSync(
                `gh run view ${runId} --log-failed`,
                {
                  cwd: this.workingDir,
                  encoding: 'utf-8',
                  maxBuffer: 10 * 1024 * 1024 // 10MB buffer for large logs
                }
              );

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
              // If we can't get logs for this specific run, continue with others
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

