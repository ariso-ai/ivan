import { execSync } from 'child_process';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';

export class ClaudeExecutor {
  async executeTask(taskDescription: string, workingDir: string): Promise<void> {
    console.log(chalk.blue(`🤖 Executing task with Claude Code: ${taskDescription}`));
    
    try {
      const claudeCommand = `claude -p "${taskDescription}"`;
      
      console.log(chalk.gray(`Running: ${claudeCommand}`));
      
      const result = execSync(claudeCommand, {
        cwd: workingDir,
        encoding: 'utf8',
        stdio: 'pipe'
      });
      
      console.log(chalk.green('✅ Claude Code execution completed'));
      
      if (result) {
        console.log(chalk.gray('Output:'));
        console.log(result);
      }
      
    } catch (error: any) {
      console.error(chalk.red('❌ Claude Code execution failed:'));
      
      if (error.stdout) {
        console.log('STDOUT:', error.stdout);
      }
      if (error.stderr) {
        console.error('STDERR:', error.stderr);
      }
      
      throw new Error(`Claude Code execution failed: ${error.message}`);
    }
  }

  private isClaudeCodeInstalled(): boolean {
    try {
      execSync('claude --version', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  validateClaudeCodeInstallation(): void {
    if (!this.isClaudeCodeInstalled()) {
      throw new Error('Claude Code CLI is not installed or not in PATH. Please install it first.');
    }
  }
}