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
          failingChecks: []
        };

        // Check for unaddressed comments
        const comments = await this.getUnaddressedComments(pr.number);
        if (comments.length > 0) {
          pullRequest.hasUnaddressedComments = true;
          pullRequest.unaddressedComments = comments;
        }

        // Check for failing checks
        const failingChecks = await this.getFailingChecks(pr.number);
        if (failingChecks.length > 0) {
          pullRequest.hasFailingChecks = true;
          pullRequest.failingChecks = failingChecks;
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
    } catch (error) {
      // If there's an error fetching comments, return empty array
      return [];
    }
  }

  private async getFailingChecks(prNumber: number): Promise<string[]> {
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

      for (const check of checks) {
        if (check.state === 'FAILURE' || check.state === 'ERROR') {
          failingChecks.push(check.name);
        }
      }

      return failingChecks;
    } catch (error) {
      // If there's an error fetching checks, return empty array
      return [];
    }
  }

  async checkoutPRBranch(prNumber: number): Promise<void> {
    execSync(`gh pr checkout ${prNumber}`, {
      cwd: this.workingDir,
      stdio: 'inherit'
    });
  }
}