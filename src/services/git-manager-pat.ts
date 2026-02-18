import { execSync } from 'child_process';
import chalk from 'chalk';
import { OpenAIService } from './openai-service.js';
import { ConfigManager } from '../config.js';
import path from 'path';
import { promises as fs } from 'fs';
import { IGitManager } from './git-interfaces.js';
import type { PRInfo } from './git-interfaces.js';
import { GitHubAPIClient } from './github-api-client.js';

export class GitManagerPAT implements IGitManager {
  public quietMode: boolean = false;
  private workingDir: string;
  private openaiService: OpenAIService | null = null;
  private configManager: ConfigManager;
  private originalWorkingDir: string;
  private githubClient: GitHubAPIClient;
  private owner: string;
  private repo: string;
  private pat: string;

  constructor(workingDir: string, pat: string) {
    this.workingDir = workingDir;
    this.originalWorkingDir = workingDir;
    this.configManager = new ConfigManager();
    this.githubClient = new GitHubAPIClient(pat);
    this.pat = pat;

    // Get repository info from git remote
    const repoInfo = GitHubAPIClient.getRepoInfoFromRemote(workingDir);
    this.owner = repoInfo.owner;
    this.repo = repoInfo.repo;
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

  validateGitHubCliInstallation(): void {
    // PAT-based implementation doesn't require GitHub CLI
    // This method is a no-op for PAT implementation
  }

  validateGitHubCliAuthentication(): void {
    // PAT-based implementation doesn't use GitHub CLI auth
    // We could validate the PAT here if needed
  }

  async createBranch(branchName: string): Promise<void> {
    this.ensureGitRepo();

    try {
      const escapedBranchName = branchName.replace(/"/g, '\\"');
      execSync(`git checkout -b "${escapedBranchName}"`, {
        cwd: this.workingDir,
        stdio: 'pipe'
      });
      if (!this.quietMode) console.log(chalk.green(`✅ Created and switched to branch: ${branchName}`));
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
        if (!this.quietMode) console.log(chalk.yellow('⚠️  No changes to commit'));
        return;
      }

      execSync('git add --all', {
        cwd: this.workingDir,
        stdio: 'pipe'
      });

      const escapedMessage = message
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/`/g, '\\`')
        .replace(/\$/g, '\\$')
        .replace(/!/g, '\\!');
      const commitMessage = `${escapedMessage}\n\nCo-authored-by: ivan-agent <ivan-agent@users.noreply.github.com>`;

      // Set git author and committer for this commit
      const gitEnv = {
        ...process.env,
        GIT_AUTHOR_NAME: 'ivan-agent',
        GIT_AUTHOR_EMAIL: 'ivan-agent@users.noreply.github.com',
        GIT_COMMITTER_NAME: 'ivan-agent',
        GIT_COMMITTER_EMAIL: 'ivan-agent@users.noreply.github.com'
      };

      execSync(`git commit -m "${commitMessage}"`, {
        cwd: this.workingDir,
        stdio: 'pipe',
        env: gitEnv
      });
      if (!this.quietMode) console.log(chalk.green(`✅ Committed changes: ${message}`));
    } catch (error) {
      throw new Error(`Failed to commit changes: ${error}`);
    }
  }

  async createEmptyCommit(message: string): Promise<void> {
    this.ensureGitRepo();

    try {
      const escapedMessage = message
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/`/g, '\\`')
        .replace(/\$/g, '\\$')
        .replace(/!/g, '\\!');
      const commitMessage = `${escapedMessage}\n\nCo-authored-by: ivan-agent <ivan-agent@users.noreply.github.com>`;

      // Set git author and committer for this commit
      const gitEnv = {
        ...process.env,
        GIT_AUTHOR_NAME: 'ivan-agent',
        GIT_AUTHOR_EMAIL: 'ivan-agent@users.noreply.github.com',
        GIT_COMMITTER_NAME: 'ivan-agent',
        GIT_COMMITTER_EMAIL: 'ivan-agent@users.noreply.github.com'
      };

      execSync(`git commit --allow-empty -m "${commitMessage}"`, {
        cwd: this.workingDir,
        stdio: 'pipe',
        env: gitEnv
      });
      if (!this.quietMode) console.log(chalk.green(`✅ Created empty commit: ${message}`));
    } catch (error) {
      throw new Error(`Failed to create empty commit: ${error}`);
    }
  }

  async pushBranch(branchName: string): Promise<void> {
    this.ensureGitRepo();

    const escapedBranchName = branchName.replace(/"/g, '\\"');

    // Use PAT for authentication by setting the remote URL with the token
    const remoteUrl = `https://x-access-token:${this.pat}@github.com/${this.owner}/${this.repo}.git`;

    // First, try to pull any remote changes to avoid conflicts
    // This handles the case where someone else pushed between worktree creation and now
    try {
      execSync(`git pull --rebase "${remoteUrl}" "${escapedBranchName}"`, {
        cwd: this.workingDir,
        stdio: 'pipe'
      });
    } catch (pullError) {
      // Pull might fail if branch doesn't exist on remote yet, which is fine
      // Or if there are no changes to pull
    }

    try {
      execSync(`git push -u "${remoteUrl}" "${escapedBranchName}"`, {
        cwd: this.workingDir,
        stdio: 'pipe'
      });
      if (!this.quietMode) console.log(chalk.green(`✅ Pushed branch to origin: ${branchName}`));
    } catch (error) {
      throw new Error(`Failed to push branch ${branchName}: ${error}`);
    }
  }

  async createPullRequest(title: string, body: string): Promise<string> {
    this.ensureGitRepo();

    const bodyWithAttribution = `${body}\n\n---\n*Co-authored with @ivan-agent*`;

    const MAX_BODY_LENGTH = 65536;
    let finalBody = bodyWithAttribution;
    if (finalBody.length > MAX_BODY_LENGTH) {
      const attributionText = '\n\n---\n*Co-authored with @ivan-agent*';
      const truncationText = '\n\n... (description truncated to fit GitHub limits)';
      const maxOriginalBodyLength = MAX_BODY_LENGTH - attributionText.length - truncationText.length;
      finalBody = body.substring(0, maxOriginalBodyLength) + truncationText + attributionText;
    }

    try {
      const currentBranch = this.getCurrentBranch();
      const mainBranch = this.getMainBranch();

      // Retry creating the PR with exponential backoff
      // GitHub API needs time to process the push before the ref is readable
      let pr;
      let lastError;
      const maxRetries = 5;

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          // Wait before attempting (exponential backoff: 1s, 2s, 4s, 8s, 16s)
          if (attempt > 0) {
            const delay = Math.min(1000 * Math.pow(2, attempt - 1), 16000);
            if (!this.quietMode) console.log(chalk.gray(`⏳ Waiting ${delay / 1000}s for GitHub to process the push...`));
            await new Promise(resolve => setTimeout(resolve, delay));
          }

          // Verify branch exists via git ls-remote before attempting PR creation
          try {
            const remoteBranches = execSync(`git ls-remote --heads origin ${currentBranch}`, {
              cwd: this.workingDir,
              encoding: 'utf8'
            });
            if (!remoteBranches.trim()) {
              throw new Error(`Branch ${currentBranch} not found on remote`);
            }
            if (!this.quietMode) console.log(chalk.gray(`✓ Verified branch ${currentBranch} exists on remote`));
          } catch (verifyError) {
            if (!this.quietMode) console.log(chalk.yellow(`⚠️  Could not verify branch on remote: ${verifyError}`));
          }

          // Create PR using GitHub API
          pr = await this.githubClient.createPullRequest(
            this.owner,
            this.repo,
            title,
            finalBody,
            currentBranch,
            mainBranch,
            true // draft
          );

          // Success! Break out of retry loop
          break;
        } catch (error) {
          lastError = error;
          const errorMessage = error instanceof Error ? error.message : String(error);

          // Only retry if it's the "not all refs are readable" error
          if (errorMessage.includes('not all refs are readable') && attempt < maxRetries - 1) {
            if (!this.quietMode) console.log(chalk.yellow(`⚠️  Branch not yet visible to GitHub API (attempt ${attempt + 1}/${maxRetries})`));
            continue;
          }

          // If it's a different error or we've exhausted retries, throw
          throw error;
        }
      }

      if (!pr) {
        throw lastError || new Error('Failed to create PR after retries');
      }

      const prUrl = pr.url;
      if (!this.quietMode) console.log(chalk.green(`✅ Created pull request: ${prUrl}`));

      // Try to assign to ivan-agent
      try {
        await this.githubClient.updatePR(this.owner, this.repo, pr.number, {
          assignees: ['ivan-agent']
        });
      } catch {
        // Ignore assignment errors
      }

      // Generate and add specific review comment
      await this.addReviewComment(prUrl, pr.number);

      return prUrl;
    } catch (error) {
      throw new Error(`Failed to create pull request: ${error}`);
    }
  }

  getChangedFiles(from?: string, to?: string): string[] {
    this.ensureGitRepo();

    try {
      if (from && to) {
        const files = execSync(`git diff --name-only ${from} ${to}`, {
          cwd: this.workingDir,
          encoding: 'utf8'
        });
        return files.split('\n').filter(line => line.trim());
      } else if (from) {
        const files = execSync(`git diff --name-only ${from}`, {
          cwd: this.workingDir,
          encoding: 'utf8'
        });
        return files.split('\n').filter(line => line.trim());
      } else {
        const status = execSync('git status --porcelain', {
          cwd: this.workingDir,
          encoding: 'utf8'
        });

        if (!status.trim()) {
          return [];
        }

        const files = status.trim().split('\n').map(line => {
          return line.substring(3).trim();
        }).filter(Boolean);

        return files;
      }
    } catch {
      return [];
    }
  }

  getDiff(from?: string, to?: string): string {
    this.ensureGitRepo();

    try {
      if (from && to) {
        const diff = execSync(`git diff ${from} ${to}`, {
          cwd: this.workingDir,
          encoding: 'utf8'
        });
        return diff;
      } else if (from) {
        const diff = execSync(`git diff ${from}`, {
          cwd: this.workingDir,
          encoding: 'utf8'
        });
        return diff;
      } else {
        execSync('git add -A', {
          cwd: this.workingDir,
          stdio: 'pipe'
        });

        const diff = execSync('git diff --cached', {
          cwd: this.workingDir,
          encoding: 'utf8'
        });

        execSync('git reset', {
          cwd: this.workingDir,
          stdio: 'pipe'
        });

        return diff;
      }
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

  getMainBranch(): string {
    this.ensureGitRepo();

    // For PAT implementation, we use local git commands for synchronous behavior
    // The GitHub API call would require async, but this method needs to be sync
    // to match the interface
    try {
      execSync('git rev-parse --verify main', {
        cwd: this.workingDir,
        stdio: 'ignore'
      });
      return 'main';
    } catch {
      try {
        execSync('git rev-parse --verify master', {
          cwd: this.workingDir,
          stdio: 'ignore'
        });
        return 'master';
      } catch {
        return 'main';
      }
    }
  }

  async cleanupAndSyncMain(): Promise<void> {
    const workDir = this.originalWorkingDir;

    try {
      execSync('git rev-parse --git-dir', {
        cwd: workDir,
        stdio: 'ignore'
      });
    } catch {
      throw new Error(`Directory is not a git repository: ${workDir}`);
    }

    try {
      const status = execSync('git status --porcelain', {
        cwd: workDir,
        encoding: 'utf8'
      });

      if (status.trim()) {
        if (!this.quietMode) console.log(chalk.yellow('⚠️  Stashing uncommitted changes'));
        execSync('git stash push -u -m "Ivan: stashing before cleanup"', {
          cwd: workDir,
          stdio: 'pipe'
        });
      }

      execSync('git clean -fd', {
        cwd: workDir,
        stdio: 'pipe'
      });

      execSync('git checkout main', {
        cwd: workDir,
        stdio: 'pipe'
      });

      execSync('git pull origin main', {
        cwd: workDir,
        stdio: 'pipe'
      });

      if (!this.quietMode) console.log(chalk.green('✅ Cleaned up and synced with main branch'));
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

  async getPRInfo(prNumber: number): Promise<PRInfo> {
    try {
      const pr = await this.githubClient.getPR(this.owner, this.repo, prNumber);
      return {
        headRefName: pr.headRefName,
        number: pr.number,
        title: pr.title,
        url: pr.url
      };
    } catch (error) {
      throw new Error(`Failed to get PR info for #${prNumber}: ${error}`);
    }
  }

  private async addReviewComment(prUrl: string, prNumber: number): Promise<void> {
    try {
      const currentBranch = this.getCurrentBranch();
      const mainBranch = this.getMainBranch();

      const diff = execSync(`git diff ${mainBranch}...${currentBranch}`, {
        cwd: this.workingDir,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024
      });

      const changedFiles = execSync(`git diff --name-only ${mainBranch}...${currentBranch}`, {
        cwd: this.workingDir,
        encoding: 'utf8'
      }).trim().split('\n').filter(f => f.trim());

      const reviewInstructions = await this.generateReviewInstructions(diff, changedFiles);
      const reviewAgent = this.configManager.getReviewAgent();
      const reviewComment = `${reviewAgent} ${reviewInstructions}`;

      await this.githubClient.addPRComment(this.owner, this.repo, prNumber, reviewComment);
      if (!this.quietMode) console.log(chalk.green(`✅ Added specific review request for ${reviewAgent}`));
    } catch (error) {
      if (!this.quietMode) console.log(chalk.yellow(`⚠️  Could not add review comment: ${error}`));
      try {
        const reviewAgent = this.configManager.getReviewAgent();
        await this.githubClient.addPRComment(
          this.owner,
          this.repo,
          prNumber,
          `${reviewAgent} please review the changes and verify the implementation meets requirements`
        );
      } catch (fallbackError) {
        if (!this.quietMode) console.log(chalk.yellow(`⚠️  Could not add fallback review comment: ${fallbackError}`));
      }
    }
  }

  private async generateReviewInstructions(diff: string, changedFiles: string[]): Promise<string> {
    try {
      if (!diff || diff.trim().length === 0) {
        if (!this.quietMode) console.log(chalk.yellow('⚠️  No diff found between branches for review instructions'));
        return 'please review the changes in this PR and verify the implementation meets requirements';
      }

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

Return ONLY the review request text, without any prefix like "Please review" since the review agent will already be prepended.`;

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
      if (!this.quietMode) console.error('Error generating review instructions:', error);
      return 'please review the changes and verify the implementation meets requirements';
    }
  }

  async createWorktree(branchName: string): Promise<string> {
    this.ensureGitRepo();

    try {
      const repoName = path.basename(this.originalWorkingDir);
      const worktreeBasePath = path.join(path.dirname(this.originalWorkingDir), `.${repoName}-ivan-worktrees`);
      const worktreePath = path.join(worktreeBasePath, branchName);

      await fs.mkdir(worktreeBasePath, { recursive: true, mode: 0o755 });

      try {
        execSync(`git worktree remove --force "${worktreePath}"`, {
          cwd: this.originalWorkingDir,
          stdio: 'ignore'
        });
      } catch {
        // Ignore if worktree doesn't exist
      }

      execSync('git worktree prune', {
        cwd: this.originalWorkingDir,
        stdio: 'pipe'
      });

      const escapedBranchName = branchName.replace(/"/g, '\\"');
      const escapedPath = worktreePath.replace(/"/g, '\\"');

      // Check if branch exists locally or on remote
      let branchExists = false;
      let branchExistsOnRemote = false;

      // Check if branch exists locally
      try {
        execSync(`git rev-parse --verify "${escapedBranchName}"`, {
          cwd: this.originalWorkingDir,
          stdio: 'ignore'
        });
        branchExists = true;
      } catch {
        branchExists = false;
      }

      // Always fetch to get the latest remote state
      try {
        if (!this.quietMode) console.log(chalk.gray(`Fetching latest changes for branch: ${branchName}`));
        execSync(`git fetch origin "${escapedBranchName}"`, {
          cwd: this.originalWorkingDir,
          stdio: 'pipe'
        });

        // Check if branch exists on remote after fetch
        try {
          execSync(`git rev-parse --verify origin/"${escapedBranchName}"`, {
            cwd: this.originalWorkingDir,
            stdio: 'ignore'
          });
          branchExistsOnRemote = true;
        } catch {
          branchExistsOnRemote = false;
        }
      } catch (fetchError) {
        if (!this.quietMode) console.log(chalk.gray(`Branch doesn't exist on remote yet`));
        branchExistsOnRemote = false;
      }

      // If branch exists on remote, ensure local branch is up to date
      if (branchExistsOnRemote) {
        try {
          // Update or create the local branch to match the remote
          execSync(`git branch -f "${escapedBranchName}" origin/"${escapedBranchName}"`, {
            cwd: this.originalWorkingDir,
            stdio: 'pipe'
          });
          branchExists = true;
          if (!this.quietMode) console.log(chalk.green(`✅ Updated local branch with latest remote changes`));
        } catch (updateError) {
          if (!this.quietMode) console.log(chalk.yellow(`⚠️  Could not update local branch: ${updateError}`));
        }
      }

      try {
        if (branchExists) {
          if (!this.quietMode) console.log(chalk.gray(`Creating worktree from existing branch: ${branchName}`));
          execSync(`git worktree add "${escapedPath}" "${escapedBranchName}"`, {
            cwd: this.originalWorkingDir,
            stdio: 'pipe'
          });
        } else {
          if (!this.quietMode) console.log(chalk.gray(`Creating new branch in worktree: ${branchName}`));
          execSync(`git worktree add -b "${escapedBranchName}" "${escapedPath}"`, {
            cwd: this.originalWorkingDir,
            stdio: 'pipe'
          });
        }
      } catch (worktreeError: unknown) {
        const errorMessage = worktreeError instanceof Error ? worktreeError.message : String(worktreeError);
        if (errorMessage.includes('already exists')) {
          if (!this.quietMode) console.log(chalk.yellow('⚠️  Worktree already exists. Removing and recreating...'));

          try {
            execSync(`git worktree remove --force "${escapedPath}"`, {
              cwd: this.originalWorkingDir,
              stdio: 'pipe'
            });
          } catch {
            // Ignore removal errors
          }

          execSync('git worktree prune', {
            cwd: this.originalWorkingDir,
            stdio: 'pipe'
          });

          if (branchExists) {
            if (!this.quietMode) console.log(chalk.gray(`Recreating worktree from existing branch: ${branchName}`));
            execSync(`git worktree add "${escapedPath}" "${escapedBranchName}"`, {
              cwd: this.originalWorkingDir,
              stdio: 'pipe'
            });
          } else {
            if (!this.quietMode) console.log(chalk.gray(`Creating new branch in worktree: ${branchName}`));
            execSync(`git worktree add -b "${escapedBranchName}" "${escapedPath}"`, {
              cwd: this.originalWorkingDir,
              stdio: 'pipe'
            });
          }
        } else {
          throw worktreeError;
        }
      }

      try {
        await fs.access(worktreePath);
      } catch {
        throw new Error(`Worktree was not created successfully at ${worktreePath}`);
      }

      if (process.platform !== 'win32') {
        try {
          const stats = await fs.stat(this.originalWorkingDir);
          await fs.chmod(worktreePath, stats.mode);

          execSync(`find "${escapedPath}" -type f -exec chmod u+rw {} \\;`, {
            cwd: path.dirname(worktreePath),
            stdio: 'ignore'
          });
          execSync(`find "${escapedPath}" -type d -exec chmod u+rwx {} \\;`, {
            cwd: path.dirname(worktreePath),
            stdio: 'ignore'
          });
        } catch (permError) {
          if (!this.quietMode) console.log(chalk.yellow(`⚠️ Could not set optimal permissions on worktree: ${permError}`));
          try {
            execSync(`chmod -R 755 "${escapedPath}"`, {
              stdio: 'ignore'
            });
          } catch {
            // Ignore permission errors
          }
        }
      }

      try {
        const userName = execSync('git config user.name || true', {
          cwd: this.originalWorkingDir,
          encoding: 'utf8'
        }).trim();
        const userEmail = execSync('git config user.email || true', {
          cwd: this.originalWorkingDir,
          encoding: 'utf8'
        }).trim();

        if (userName) {
          execSync(`git config user.name "${userName}"`, {
            cwd: worktreePath,
            stdio: 'pipe'
          });
        }
        if (userEmail) {
          execSync(`git config user.email "${userEmail}"`, {
            cwd: worktreePath,
            stdio: 'pipe'
          });
        }
      } catch (configError) {
        if (!this.quietMode) console.log(chalk.yellow(`⚠️ Could not copy git config to worktree: ${configError}`));
      }

      try {
        const packageJsonPath = path.join(worktreePath, 'package.json');
        await fs.access(packageJsonPath);

        if (!this.quietMode) console.log(chalk.cyan('📦 Found package.json, installing dependencies...'));
        execSync('npm install', {
          cwd: worktreePath,
          stdio: this.quietMode ? 'pipe' : 'inherit'
        });
        if (!this.quietMode) console.log(chalk.green('✅ Dependencies installed successfully'));
      } catch {
        if (!this.quietMode) console.log(chalk.gray('ℹ️  No package.json found or npm install not needed'));
      }

      if (!this.quietMode) {
        console.log(chalk.green(`✅ Created worktree at: ${worktreePath}`));
        console.log(chalk.gray('You can continue working in your main repository while Ivan works here'));
      }
      return worktreePath;
    } catch (error) {
      throw new Error(`Failed to create worktree for branch ${branchName}: ${error}`);
    }
  }

  async removeWorktree(branchName: string): Promise<void> {
    try {
      const repoName = path.basename(this.originalWorkingDir);
      const worktreeBasePath = path.join(path.dirname(this.originalWorkingDir), `.${repoName}-ivan-worktrees`);
      const worktreePath = path.join(worktreeBasePath, branchName);
      const escapedPath = worktreePath.replace(/"/g, '\\"');

      execSync(`git worktree remove --force "${escapedPath}"`, {
        cwd: this.originalWorkingDir,
        stdio: 'pipe'
      });

      execSync('git worktree prune', {
        cwd: this.originalWorkingDir,
        stdio: 'pipe'
      });

      try {
        const files = await fs.readdir(worktreeBasePath);
        if (files.length === 0) {
          await fs.rmdir(worktreeBasePath);
        }
      } catch {
        // Ignore errors
      }

      if (!this.quietMode) console.log(chalk.green(`✅ Removed worktree for branch: ${branchName}`));
    } catch (error) {
      if (!this.quietMode) console.log(chalk.yellow(`⚠️ Could not remove worktree: ${error}`));
    }
  }

  switchToWorktree(worktreePath: string): void {
    this.workingDir = worktreePath;
  }

  switchToOriginalDir(): void {
    this.workingDir = this.originalWorkingDir;
  }

  getWorktreePath(branchName: string): string {
    const repoName = path.basename(this.originalWorkingDir);
    return path.join(path.dirname(this.originalWorkingDir), `.${repoName}-ivan-worktrees`, branchName);
  }
}
