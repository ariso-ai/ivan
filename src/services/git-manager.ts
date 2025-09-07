import { execSync } from 'child_process';
import chalk from 'chalk';

export class GitManager {
  private ensureGitRepo(): void {
    try {
      execSync('git rev-parse --git-dir', { stdio: 'ignore' });
    } catch {
      throw new Error('Current directory is not a git repository');
    }
  }

  async createBranch(branchName: string): Promise<void> {
    this.ensureGitRepo();
    
    try {
      execSync(`git checkout -b "${branchName}"`, { stdio: 'pipe' });
      console.log(chalk.green(`✅ Created and switched to branch: ${branchName}`));
    } catch (error) {
      throw new Error(`Failed to create branch ${branchName}: ${error}`);
    }
  }

  async commitChanges(message: string): Promise<void> {
    this.ensureGitRepo();
    
    try {
      const status = execSync('git status --porcelain', { encoding: 'utf8' });
      if (!status.trim()) {
        console.log(chalk.yellow('⚠️  No changes to commit'));
        return;
      }

      execSync('git add .', { stdio: 'pipe' });
      execSync(`git commit -m "${message}"`, { stdio: 'pipe' });
      console.log(chalk.green(`✅ Committed changes: ${message}`));
    } catch (error) {
      throw new Error(`Failed to commit changes: ${error}`);
    }
  }

  async pushBranch(branchName: string): Promise<void> {
    this.ensureGitRepo();
    
    try {
      execSync(`git push -u origin "${branchName}"`, { stdio: 'pipe' });
      console.log(chalk.green(`✅ Pushed branch to origin: ${branchName}`));
    } catch (error) {
      throw new Error(`Failed to push branch ${branchName}: ${error}`);
    }
  }

  async createPullRequest(title: string, body: string): Promise<string> {
    this.ensureGitRepo();
    
    try {
      const result = execSync(`gh pr create --title "${title}" --body "${body}"`, { 
        encoding: 'utf8',
        stdio: 'pipe'
      });
      
      const prUrl = result.trim();
      console.log(chalk.green(`✅ Created pull request: ${prUrl}`));
      return prUrl;
    } catch (error) {
      throw new Error(`Failed to create pull request: ${error}`);
    }
  }

  getChangedFiles(): string[] {
    this.ensureGitRepo();
    
    try {
      const result = execSync('git diff --name-only HEAD', { encoding: 'utf8' });
      return result.trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }

  getDiff(): string {
    this.ensureGitRepo();
    
    try {
      return execSync('git diff HEAD', { encoding: 'utf8' });
    } catch {
      return '';
    }
  }

  getCurrentBranch(): string {
    this.ensureGitRepo();
    
    try {
      return execSync('git branch --show-current', { encoding: 'utf8' }).trim();
    } catch {
      return '';
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