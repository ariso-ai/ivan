import { execSync } from 'child_process';
import chalk from 'chalk';

export class ClaudeExecutor {
  async executeTask(taskDescription: string, workingDir: string): Promise<string> {
    console.log(chalk.blue(`🤖 Executing task with Claude Code: ${taskDescription}`));

    try {
      const claudeCommand = `claude "${taskDescription}" --verbose --dangerously-skip-permissions`;

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

      return result || '';

    } catch (error: unknown) {
      console.error(chalk.red('❌ Claude Code execution failed:'));

      const err = error as Error & { stdout?: string; stderr?: string };
      let errorLog = `Claude Code execution failed: ${err.message}`;

      if (err.stdout) {
        console.log('STDOUT:', err.stdout);
        errorLog += `\nSTDOUT: ${err.stdout}`;
      }
      if (err.stderr) {
        console.error('STDERR:', err.stderr);
        errorLog += `\nSTDERR: ${err.stderr}`;
      }

      throw new Error(errorLog);
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

