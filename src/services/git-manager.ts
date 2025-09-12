import { execSync } from 'child_process';
import chalk from 'chalk';
import { OpenAIService } from './openai-service.js';

export class GitManager {
  private workingDir: string;
  private openaiService: OpenAIService | null = null;

  constructor(workingDir: string) {
    this.workingDir = workingDir;
  }

  private getOpenAIService(): OpenAIService {
    if (!this.openaiService) {
      this.openaiService = new OpenAIService();
    }
    return this.openaiService;
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

      // Generate and add specific review comment
      await this.addReviewComment(prUrl);

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

        // Generate and add specific review comment
        await this.addReviewComment(prUrl);

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

  async getPRInfo(prNumber: number): Promise<any> {
    try {
      const prJson = execSync(`gh pr view ${prNumber} --json headRefName,number,title,url`, {
        cwd: this.workingDir,
        encoding: 'utf8'
      });
      return JSON.parse(prJson);
    } catch (error) {
      throw new Error(`Failed to get PR info for #${prNumber}: ${error}`);
    }
  }

  private async addReviewComment(prUrl: string): Promise<void> {
    try {
      // Get the latest changes
      const diff = this.getDiff();
      const changedFiles = this.getChangedFiles();
      
      // Generate specific review instructions using OpenAI
      const reviewInstructions = await this.generateReviewInstructions(diff, changedFiles);
      
      // Add the review comment
      const reviewComment = `@codex ${reviewInstructions}`;
      
      execSync(`gh pr comment ${prUrl} --body "${reviewComment.replace(/"/g, '\\"')}"`, {
        cwd: this.workingDir,
        stdio: 'pipe'
      });
      console.log(chalk.green('✅ Added specific review request for @codex'));
    } catch (error) {
      console.log(chalk.yellow(`⚠️ Could not add review comment: ${error}`));
      // Fallback to generic review request
      try {
        execSync(`gh pr comment ${prUrl} --body "@codex please review the changes and verify the implementation meets requirements"`, {
          cwd: this.workingDir,
          stdio: 'pipe'
        });
      } catch (fallbackError) {
        console.log(chalk.yellow(`⚠️ Could not add fallback review comment: ${fallbackError}`));
      }
    }
  }

  private async generateReviewInstructions(diff: string, changedFiles: string[]): Promise<string> {
    try {
      const openaiService = this.getOpenAIService();
      const client = await openaiService.getClient();
      
      const prompt = `You are reviewing a new pull request. Based on the following diff and changed files, generate a concise, specific review request that tells the reviewer what to focus on.

Changed files:
${changedFiles.join('\n')}

Diff:
${diff.substring(0, 8000)}${diff.length > 8000 ? '\n... (diff truncated)' : ''}

Generate a brief (1-2 sentences) review request that:
1. Mentions the key changes or features implemented
2. Asks the reviewer to verify specific aspects of the implementation
3. Is conversational and clear

Example format: "please review the new task executor implementation and verify that error handling properly captures all edge cases"

Return ONLY the review request text, without any prefix like "Please review" since @codex will already be prepended.`;

      const completion = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant that generates specific code review requests for new pull requests.'
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
        return 'please review the changes and verify the implementation meets requirements';
      }

      return reviewRequest;
    } catch (error) {
      console.error('Error generating review instructions:', error);
      // Fallback to a generic message if OpenAI fails
      return 'please review the changes and verify the implementation meets requirements';
    }
  }
}
