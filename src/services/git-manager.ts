import { execSync } from 'child_process';
import chalk from 'chalk';

export class GitManager {
  private workingDir: string;

  constructor(workingDir: string) {
    this.workingDir = workingDir;
  }

  private ensureGitRepo(): void {
    try {
      execSync('git rev-parse --git-dir', {
        cwd: this.workingDir,
        stdio: 'ignore'
      });
    } catch {
      throw new Error(`Directory is not a git repository: ${this.workingDir}`);
    }
  }

  private isGitHubCliInstalled(): boolean {
    try {
      execSync('gh --version', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  validateGitHubCliInstallation(): void {
    if (!this.isGitHubCliInstalled()) {
      throw new Error('GitHub CLI (gh) is not installed or not in PATH. Please install it first:\n' +
        '  macOS: brew install gh\n' +
        '  Ubuntu/Debian: sudo apt install gh\n' +
        '  Or visit: https://cli.github.com/');
    }
  }

  validateGitHubCliAuthentication(): void {
    try {
      execSync('gh auth status', { stdio: 'ignore' });
    } catch {
      throw new Error('GitHub CLI is not authenticated. Please run "gh auth login" first.');
    }
  }

  async createBranch(branchName: string): Promise<void> {
    this.ensureGitRepo();

    try {
      const escapedBranchName = branchName.replace(/"/g, '\\"');
      execSync(`git checkout -b "${escapedBranchName}"`, {
        cwd: this.workingDir,
        stdio: 'pipe'
      });
      console.log(chalk.green(`✅ Created and switched to branch: ${branchName}`));
    } catch (error) {
      throw new Error(`Failed to create branch ${branchName}: ${error}`);
    }
  }

  async commitChanges(message: string): Promise<void> {
    this.ensureGitRepo();

    try {
      const status = execSync('git status --porcelain', {
        cwd: this.workingDir,
        encoding: 'utf8'
      });
      if (!status.trim()) {
        console.log(chalk.yellow('⚠️  No changes to commit'));
        return;
      }

      execSync('git add .', {
        cwd: this.workingDir,
        stdio: 'pipe'
      });
      const escapedMessage = message.replace(/"/g, '\\"');
      const commitMessage = `${escapedMessage}\n\nCo-authored-by: ari-agent <ari-agent@users.noreply.github.com>`;
      execSync(`git commit -m "${commitMessage}"`, {
        cwd: this.workingDir,
        stdio: 'pipe'
      });
      console.log(chalk.green(`✅ Committed changes: ${message}`));
    } catch (error) {
      throw new Error(`Failed to commit changes: ${error}`);
    }
  }

  async createEmptyCommit(message: string): Promise<void> {
    this.ensureGitRepo();

    try {
      const escapedMessage = message.replace(/"/g, '\\"');
      const commitMessage = `${escapedMessage}\n\nCo-authored-by: ari-agent <ari-agent@users.noreply.github.com>`;
      execSync(`git commit --allow-empty -m "${commitMessage}"`, {
        cwd: this.workingDir,
        stdio: 'pipe'
      });
      console.log(chalk.green(`✅ Created empty commit: ${message}`));
    } catch (error) {
      throw new Error(`Failed to create empty commit: ${error}`);
    }
  }

  async pushBranch(branchName: string): Promise<void> {
    this.ensureGitRepo();

    try {
      const escapedBranchName = branchName.replace(/"/g, '\\"');
      execSync(`git push -u origin "${escapedBranchName}"`, {
        cwd: this.workingDir,
        stdio: 'pipe'
      });
      console.log(chalk.green(`✅ Pushed branch to origin: ${branchName}`));
    } catch (error) {
      throw new Error(`Failed to push branch ${branchName}: ${error}`);
    }
  }

  async createPullRequest(title: string, body: string): Promise<string> {
    this.ensureGitRepo();

    try {
      const escapedTitle = title.replace(/"/g, '\\"');
      // Add attribution to @ari-agent in the PR body
      const bodyWithAttribution = `${body}\n\n---\n*Co-authored with @ari-agent*`;
      const escapedBody = bodyWithAttribution.replace(/"/g, '\\"');

      // Create PR and optionally assign to ari-agent (will fail silently if user doesn't have permissions)
      const result = execSync(`gh pr create --title "${escapedTitle}" --body "${escapedBody}" --assignee ari-agent`, {
        cwd: this.workingDir,
        encoding: 'utf8',
        stdio: 'pipe'
      });

      const prUrl = result.trim();
      console.log(chalk.green(`✅ Created pull request: ${prUrl}`));

      // Add comment requesting review from @codex
      try {
        execSync(`gh pr comment ${prUrl} --body "@codex review please"`, {
          cwd: this.workingDir,
          stdio: 'pipe'
        });
        console.log(chalk.green('✅ Added review request comment for @codex'));
      } catch (commentError) {
        console.log(chalk.yellow(`⚠️ Could not add review comment: ${commentError}`));
      }

      return prUrl;
    } catch {
      // If assignee fails, try without it
      try {
        const escapedTitle = title.replace(/"/g, '\\"');
        const bodyWithAttribution = `${body}\n\n---\n*Co-authored with @ari-agent*`;
        const escapedBody = bodyWithAttribution.replace(/"/g, '\\"');
        const result = execSync(`gh pr create --title "${escapedTitle}" --body "${escapedBody}"`, {
          cwd: this.workingDir,
          encoding: 'utf8',
          stdio: 'pipe'
        });

        const prUrl = result.trim();
        console.log(chalk.green(`✅ Created pull request: ${prUrl}`));

        // Add comment requesting review from @codex
        try {
          execSync(`gh pr comment ${prUrl} --body "@codex review please"`, {
            cwd: this.workingDir,
            stdio: 'pipe'
          });
          console.log(chalk.green('✅ Added review request comment for @codex'));
        } catch (commentError) {
          console.log(chalk.yellow(`⚠️ Could not add review comment: ${commentError}`));
        }

        return prUrl;
      } catch (fallbackError) {
        throw new Error(`Failed to create pull request: ${fallbackError}`);
      }
    }
  }

  getChangedFiles(): string[] {
    this.ensureGitRepo();

    try {
      const result = execSync('git diff --name-only HEAD', {
        cwd: this.workingDir,
        encoding: 'utf8'
      });
      return result.trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }

  getDiff(): string {
    this.ensureGitRepo();

    try {
      return execSync('git diff HEAD', {
        cwd: this.workingDir,
        encoding: 'utf8'
      });
    } catch {
      return '';
    }
  }

  getCurrentBranch(): string {
    this.ensureGitRepo();

    try {
      return execSync('git branch --show-current', {
        cwd: this.workingDir,
        encoding: 'utf8'
      }).trim();
    } catch {
      return '';
    }
  }

  async cleanupAndSyncMain(): Promise<void> {
    this.ensureGitRepo();

    try {
      // Stash any uncommitted changes
      const status = execSync('git status --porcelain', {
        cwd: this.workingDir,
        encoding: 'utf8'
      });

      if (status.trim()) {
        console.log(chalk.yellow('⚠️  Stashing uncommitted changes'));
        execSync('git stash push -u -m "Ivan: stashing before cleanup"', {
          cwd: this.workingDir,
          stdio: 'pipe'
        });
      }

      // Remove any untracked files and directories
      execSync('git clean -fd', {
        cwd: this.workingDir,
        stdio: 'pipe'
      });

      // Switch to main branch
      execSync('git checkout main', {
        cwd: this.workingDir,
        stdio: 'pipe'
      });

      // Pull latest changes
      execSync('git pull origin main', {
        cwd: this.workingDir,
        stdio: 'pipe'
      });

      console.log(chalk.green('✅ Cleaned up and synced with main branch'));
    } catch (error) {
      throw new Error(`Failed to cleanup and sync main: ${error}`);
    }
  }

  generateBranchName(taskDescription: string): string {
    const sanitized = taskDescription
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, '-')
      .substring(0, 50);

    const timestamp = Date.now().toString().slice(-6);
    return `ivan/${sanitized}-${timestamp}`;
  }
}
