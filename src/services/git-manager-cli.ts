import { execSync } from 'child_process';
import chalk from 'chalk';
import { OpenAIService } from './openai-service.js';
import { ConfigManager } from '../config.js';
import path from 'path';
import { promises as fs, writeFileSync, unlinkSync } from 'fs';
import os from 'os';
import type { IGitManager, PRInfo } from './git-interfaces.js';

export class GitManagerCLI implements IGitManager {
  private workingDir: string;
  private openaiService: OpenAIService | null = null;
  private configManager: ConfigManager;
  private originalWorkingDir: string;

  constructor(workingDir: string) {
    this.workingDir = workingDir;
    this.originalWorkingDir = workingDir;
    this.configManager = new ConfigManager();
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

      execSync('git add --all', {
        cwd: this.workingDir,
        stdio: 'pipe'
      });
      // Escape all shell special characters including backticks, quotes, and dollar signs
      const escapedMessage = message
        .replace(/\\/g, '\\\\')  // Escape backslashes first
        .replace(/"/g, '\\"')    // Escape double quotes
        .replace(/`/g, '\\`')    // Escape backticks
        .replace(/\$/g, '\\$')   // Escape dollar signs
        .replace(/!/g, '\\!');   // Escape exclamation marks
      const commitMessage = `${escapedMessage}\n\nCo-authored-by: ivan-agent <ivan-agent@users.noreply.github.com>`;
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
      // Escape all shell special characters including backticks, quotes, and dollar signs
      const escapedMessage = message
        .replace(/\\/g, '\\\\')  // Escape backslashes first
        .replace(/"/g, '\\"')    // Escape double quotes
        .replace(/`/g, '\\`')    // Escape backticks
        .replace(/\$/g, '\\$')   // Escape dollar signs
        .replace(/!/g, '\\!');   // Escape exclamation marks
      const commitMessage = `${escapedMessage}\n\nCo-authored-by: ivan-agent <ivan-agent@users.noreply.github.com>`;
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

    // Add attribution to @ivan-agent in the PR body
    const bodyWithAttribution = `${body}\n\n---\n*Co-authored with @ivan-agent*`;

    // Ensure the final body doesn't exceed GitHub's limit (65536 characters)
    const MAX_BODY_LENGTH = 65536;
    let finalBody = bodyWithAttribution;
    if (finalBody.length > MAX_BODY_LENGTH) {
      // Truncate the original body to fit within the limit, accounting for the attribution
      const attributionText = '\n\n---\n*Co-authored with @ivan-agent*';
      const truncationText = '\n\n... (description truncated to fit GitHub limits)';
      const maxOriginalBodyLength = MAX_BODY_LENGTH - attributionText.length - truncationText.length;
      finalBody = body.substring(0, maxOriginalBodyLength) + truncationText + attributionText;
    }

    // Write PR body to a temporary file to avoid shell escaping issues
    const tmpDir = os.tmpdir();
    const tmpFile = path.join(tmpDir, `pr-body-${Date.now()}.md`);
    writeFileSync(tmpFile, finalBody, 'utf8');

    try {
      const escapedTitle = title.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$');

      // Create PR and optionally assign to ivan-agent (will fail silently if user doesn't have permissions)
      const result = execSync(`gh pr create --draft --title "${escapedTitle}" --body-file "${tmpFile}" --assignee ivan-agent`, {
        cwd: this.workingDir,
        encoding: 'utf8',
        stdio: 'pipe'
      });

      const prUrl = result.trim();
      console.log(chalk.green(`✅ Created pull request: ${prUrl}`));

      // Clean up temp file
      try {
        unlinkSync(tmpFile);
      } catch {
        // Ignore file deletion errors
      }

      // Generate and add specific review comment
      await this.addReviewComment(prUrl);

      return prUrl;
    } catch {
      // If assignee fails, try without it
      try {
        const escapedTitle = title.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$');
        const result = execSync(`gh pr create --draft --title "${escapedTitle}" --body-file "${tmpFile}"`, {
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
      } finally {
        // Clean up temp file
        try {
          unlinkSync(tmpFile);
        } catch {
          // Ignore file deletion errors
        }
      }
    }
  }

  getChangedFiles(from?: string, to?: string): string[] {
    this.ensureGitRepo();

    try {
      if (from && to) {
        // Get files changed between two refs
        const files = execSync(`git diff --name-only ${from} ${to}`, {
          cwd: this.workingDir,
          encoding: 'utf8'
        });
        return files.split('\n').filter(line => line.trim());
      } else if (from) {
        // Get files changed from a specific ref to current
        const files = execSync(`git diff --name-only ${from}`, {
          cwd: this.workingDir,
          encoding: 'utf8'
        });
        return files.split('\n').filter(line => line.trim());
      } else {
        // Default: Check both staged and unstaged changes, plus untracked files
        const status = execSync('git status --porcelain', {
          cwd: this.workingDir,
          encoding: 'utf8'
        });

        if (!status.trim()) {
          return [];
        }

        // Parse git status output to get file names
        const files = status.trim().split('\n').map(line => {
          // Remove status codes and get the file path
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
        // Get diff between two refs
        const diff = execSync(`git diff ${from} ${to}`, {
          cwd: this.workingDir,
          encoding: 'utf8'
        });
        return diff;
      } else if (from) {
        // Get diff from a specific ref to current
        const diff = execSync(`git diff ${from}`, {
          cwd: this.workingDir,
          encoding: 'utf8'
        });
        return diff;
      } else {
        // Default: First, add all changes to staging area (without committing)
        // This allows us to see all changes including untracked files
        execSync('git add -A', {
          cwd: this.workingDir,
          stdio: 'pipe'
        });

        // Get diff of all staged changes
        const diff = execSync('git diff --cached', {
          cwd: this.workingDir,
          encoding: 'utf8'
        });

        // Reset the staging area to leave files as they were
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

    try {
      // Try to get the default branch from GitHub
      const remoteInfo = execSync('gh repo view --json defaultBranchRef', {
        cwd: this.workingDir,
        encoding: 'utf8',
        stdio: 'pipe'
      });
      const parsed = JSON.parse(remoteInfo);
      if (parsed?.defaultBranchRef?.name) {
        return parsed.defaultBranchRef.name;
      }
    } catch {
      // Fallback to checking common branch names
    }

    // Check if main exists
    try {
      execSync('git rev-parse --verify main', {
        cwd: this.workingDir,
        stdio: 'ignore'
      });
      return 'main';
    } catch {
      // Try master
      try {
        execSync('git rev-parse --verify master', {
          cwd: this.workingDir,
          stdio: 'ignore'
        });
        return 'master';
      } catch {
        return 'main'; // Default to main
      }
    }
  }

  async cleanupAndSyncMain(): Promise<void> {
    // Always operate on the original directory for main branch operations
    const workDir = this.originalWorkingDir;

    try {
      // Ensure git repo in original directory
      execSync('git rev-parse --git-dir', {
        cwd: workDir,
        stdio: 'ignore'
      });
    } catch {
      throw new Error(`Directory is not a git repository: ${workDir}`);
    }

    try {
      // Stash any uncommitted changes
      const status = execSync('git status --porcelain', {
        cwd: workDir,
        encoding: 'utf8'
      });

      if (status.trim()) {
        console.log(chalk.yellow('⚠️  Stashing uncommitted changes'));
        execSync('git stash push -u -m "Ivan: stashing before cleanup"', {
          cwd: workDir,
          stdio: 'pipe'
        });
      }

      // Remove any untracked files and directories
      execSync('git clean -fd', {
        cwd: workDir,
        stdio: 'pipe'
      });

      // Switch to main branch
      execSync('git checkout main', {
        cwd: workDir,
        stdio: 'pipe'
      });

      // Pull latest changes
      execSync('git pull origin main', {
        cwd: workDir,
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

  async getPRInfo(prNumber: number): Promise<PRInfo> {
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
      // Get the diff between main branch and current branch for the PR
      const currentBranch = this.getCurrentBranch();
      const mainBranch = this.getMainBranch();

      // Get diff between main and current branch
      const diff = execSync(`git diff ${mainBranch}...${currentBranch}`, {
        cwd: this.workingDir,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024 // 10MB buffer for large diffs
      });

      // Get list of changed files between main and current branch
      const changedFiles = execSync(`git diff --name-only ${mainBranch}...${currentBranch}`, {
        cwd: this.workingDir,
        encoding: 'utf8'
      }).trim().split('\n').filter(f => f.trim());

      // Generate specific review instructions using OpenAI
      const reviewInstructions = await this.generateReviewInstructions(diff, changedFiles);

      // Get configured review agent
      const reviewAgent = this.configManager.getReviewAgent();

      // Add the review comment
      const reviewComment = `${reviewAgent} ${reviewInstructions}`;

      execSync(`gh pr comment ${prUrl} --body "${reviewComment.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$')}"`, {
        cwd: this.workingDir,
        stdio: 'pipe'
      });
      console.log(chalk.green(`✅ Added specific review request for ${reviewAgent}`));
    } catch (error) {
      console.log(chalk.yellow(`⚠️ Could not add review comment: ${error}`));
      // Fallback to generic review request
      try {
        const reviewAgent = this.configManager.getReviewAgent();
        execSync(`gh pr comment ${prUrl} --body "${reviewAgent} please review the changes and verify the implementation meets requirements"`, {
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
      // Check if we have actual diff content
      if (!diff || diff.trim().length === 0) {
        console.log(chalk.yellow('⚠️ No diff found between branches for review instructions'));
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
      console.error('Error generating review instructions:', error);
      // Fallback to a generic message if OpenAI fails
      return 'please review the changes and verify the implementation meets requirements';
    }
  }

  async createWorktree(branchName: string): Promise<string> {
    this.ensureGitRepo();

    try {
      // Create worktree directory inside the repo's parent directory
      // This ensures it has the same permissions as the main repo
      const repoName = path.basename(this.originalWorkingDir);
      const worktreeBasePath = path.join(path.dirname(this.originalWorkingDir), `.${repoName}-ivan-worktrees`);
      const worktreePath = path.join(worktreeBasePath, branchName);

      // Ensure the parent directory exists with proper permissions
      await fs.mkdir(worktreeBasePath, { recursive: true, mode: 0o755 });

      // Remove any existing worktree at this path (in case of previous failure)
      try {
        execSync(`git worktree remove --force "${worktreePath}"`, {
          cwd: this.originalWorkingDir,
          stdio: 'ignore'
        });
      } catch {
        // Ignore if worktree doesn't exist
      }

      // Clean up any stale worktree entries
      execSync('git worktree prune', {
        cwd: this.originalWorkingDir,
        stdio: 'pipe'
      });

      // Create the worktree
      const escapedBranchName = branchName.replace(/"/g, '\\"');
      const escapedPath = worktreePath.replace(/"/g, '\\"');

      // Check if branch already exists
      let branchExists = false;
      try {
        execSync(`git rev-parse --verify "${escapedBranchName}"`, {
          cwd: this.originalWorkingDir,
          stdio: 'ignore'
        });
        branchExists = true;
      } catch {
        branchExists = false;
      }

      // Try to create the worktree
      try {
        if (branchExists) {
          // Branch exists, create worktree from it
          console.log(chalk.gray(`Creating worktree from existing branch: ${branchName}`));
          execSync(`git worktree add "${escapedPath}" "${escapedBranchName}"`, {
            cwd: this.originalWorkingDir,
            stdio: 'pipe'
          });
        } else {
          // Branch doesn't exist, create new branch in worktree
          console.log(chalk.gray(`Creating new branch in worktree: ${branchName}`));
          execSync(`git worktree add -b "${escapedBranchName}" "${escapedPath}"`, {
            cwd: this.originalWorkingDir,
            stdio: 'pipe'
          });
        }
      } catch (worktreeError: unknown) {
        const errorMessage = worktreeError instanceof Error ? worktreeError.message : String(worktreeError);

        // Handle "already used by worktree" error - branch is checked out elsewhere
        if (errorMessage.includes('is already used by worktree') || errorMessage.includes('is already checked out')) {
          console.log(chalk.yellow(`⚠️  Branch ${branchName} is already checked out elsewhere. Creating worktree with --force...`));

          // Use --force to allow checking out a branch that's already checked out
          execSync(`git worktree add --force "${escapedPath}" "${escapedBranchName}"`, {
            cwd: this.originalWorkingDir,
            stdio: 'pipe'
          });
        }
        // Handle "already exists" error - worktree path already exists
        else if (errorMessage.includes('already exists')) {
          console.log(chalk.yellow('⚠️  Worktree already exists. Removing and recreating...'));

          // Force remove the existing worktree
          try {
            execSync(`git worktree remove --force "${escapedPath}"`, {
              cwd: this.originalWorkingDir,
              stdio: 'pipe'
            });
          } catch {
            // Ignore removal errors
          }

          // Clean up any stale worktree entries
          execSync('git worktree prune', {
            cwd: this.originalWorkingDir,
            stdio: 'pipe'
          });

          // Retry creating the worktree (with --force if branch exists)
          if (branchExists) {
            console.log(chalk.gray(`Recreating worktree from existing branch: ${branchName}`));
            // Try with --force first in case the branch is checked out elsewhere
            try {
              execSync(`git worktree add --force "${escapedPath}" "${escapedBranchName}"`, {
                cwd: this.originalWorkingDir,
                stdio: 'pipe'
              });
            } catch (retryError: unknown) {
              const retryErrorMessage = retryError instanceof Error ? retryError.message : String(retryError);
              // If --force fails, it might be due to a different issue, so try without it
              if (!retryErrorMessage.includes('is already used by worktree') && !retryErrorMessage.includes('is already checked out')) {
                execSync(`git worktree add "${escapedPath}" "${escapedBranchName}"`, {
                  cwd: this.originalWorkingDir,
                  stdio: 'pipe'
                });
              } else {
                throw retryError;
              }
            }
          } else {
            console.log(chalk.gray(`Creating new branch in worktree: ${branchName}`));
            execSync(`git worktree add -b "${escapedBranchName}" "${escapedPath}"`, {
              cwd: this.originalWorkingDir,
              stdio: 'pipe'
            });
          }
        } else {
          throw worktreeError;
        }
      }

      // Verify the worktree was created successfully
      try {
        await fs.access(worktreePath);
      } catch {
        throw new Error(`Worktree was not created successfully at ${worktreePath}`);
      }

      // Set proper permissions - make sure the current user owns all files
      if (process.platform !== 'win32') {
        try {
          // Use the same permissions as the original repo
          const stats = await fs.stat(this.originalWorkingDir);
          await fs.chmod(worktreePath, stats.mode);

          // Make sure all files are readable and writable by the owner
          execSync(`find "${escapedPath}" -type f -exec chmod u+rw {} \\;`, {
            cwd: path.dirname(worktreePath),
            stdio: 'ignore'
          });
          execSync(`find "${escapedPath}" -type d -exec chmod u+rwx {} \\;`, {
            cwd: path.dirname(worktreePath),
            stdio: 'ignore'
          });
        } catch (permError) {
          console.log(chalk.yellow(`⚠️ Could not set optimal permissions on worktree: ${permError}`));
          // Try simpler chmod as fallback
          try {
            execSync(`chmod -R 755 "${escapedPath}"`, {
              stdio: 'ignore'
            });
          } catch {
            // Ignore permission errors on systems where chmod doesn't work
          }
        }
      }

      // Copy git config from main repo to ensure commits work
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
        console.log(chalk.yellow(`⚠️ Could not copy git config to worktree: ${configError}`));
      }

      // Check if package.json exists and run npm install if it does
      try {
        const packageJsonPath = path.join(worktreePath, 'package.json');
        await fs.access(packageJsonPath);

        console.log(chalk.cyan('📦 Found package.json, installing dependencies...'));
        execSync('npm install', {
          cwd: worktreePath,
          stdio: 'inherit'
        });
        console.log(chalk.green('✅ Dependencies installed successfully'));
      } catch {
        // No package.json or npm install failed, continue without error
        console.log(chalk.gray('ℹ️  No package.json found or npm install not needed'));
      }

      console.log(chalk.green(`✅ Created worktree at: ${worktreePath}`));
      console.log(chalk.gray('You can continue working in your main repository while Ivan works here'));
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

      // Remove the worktree
      execSync(`git worktree remove --force "${escapedPath}"`, {
        cwd: this.originalWorkingDir,
        stdio: 'pipe'
      });

      // Prune worktree list
      execSync('git worktree prune', {
        cwd: this.originalWorkingDir,
        stdio: 'pipe'
      });

      // Try to remove the base directory if it's empty
      try {
        const files = await fs.readdir(worktreeBasePath);
        if (files.length === 0) {
          await fs.rmdir(worktreeBasePath);
        }
      } catch {
        // Ignore errors when cleaning up directories
      }

      console.log(chalk.green(`✅ Removed worktree for branch: ${branchName}`));
    } catch (error) {
      console.log(chalk.yellow(`⚠️ Could not remove worktree: ${error}`));
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
