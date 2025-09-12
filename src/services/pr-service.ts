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

  private async getUnaddressedComments(prNumber: number): Promise<PRComment[]> {
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
      const unaddressedComments: PRComment[] = [];

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