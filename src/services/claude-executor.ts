import { execSync } from 'child_process';
import chalk from 'chalk';

export class ClaudeExecutor {
  async executeTask(taskDescription: string, workingDir: string): Promise<string> {
    console.log(chalk.blue(`🤖 Executing task with Claude Code: ${taskDescription}`));

    try {
      const claudeCommand = `claude --print "${taskDescription}" --verbose --dangerously-skip-permissions`;

      console.log(chalk.gray(`Running: ${claudeCommand}`));
      console.log(chalk.gray(`Working directory: ${workingDir}`));
      console.log(chalk.yellow('⏳ Starting Claude Code execution...'));

      const result = execSync(claudeCommand, {
        cwd: workingDir,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'], // Explicitly set stdin, stdout, stderr
        timeout: 300000 // 5 minute timeout
      });

      console.log(chalk.green('✅ Claude Code execution completed'));

      if (result && result.trim()) {
        console.log(chalk.cyan('📋 Claude Code Output:'));
        console.log(chalk.gray('─'.repeat(50)));
        console.log(result);
        console.log(chalk.gray('─'.repeat(50)));
      } else {
        console.log(chalk.yellow('⚠️  No output from Claude Code'));
      }

      return result || '';

    } catch (error: unknown) {
      console.error(chalk.red('❌ Claude Code execution failed:'));

      const err = error as Error & { stdout?: string; stderr?: string; status?: number; signal?: string };
      let errorLog = `Claude Code execution failed: ${err.message}`;

      if (err.status) {
        console.log(chalk.red(`Exit code: ${err.status}`));
        errorLog += `\nExit code: ${err.status}`;
      }

      if (err.signal) {
        console.log(chalk.red(`Signal: ${err.signal}`));
        errorLog += `\nSignal: ${err.signal}`;
      }

      if (err.stdout) {
        console.log(chalk.cyan('STDOUT:'));
        console.log(chalk.gray('─'.repeat(30)));
        console.log(err.stdout);
        console.log(chalk.gray('─'.repeat(30)));
        errorLog += `\nSTDOUT: ${err.stdout}`;
      }

      if (err.stderr) {
        console.log(chalk.red('STDERR:'));
        console.log(chalk.gray('─'.repeat(30)));
        console.error(err.stderr);
        console.log(chalk.gray('─'.repeat(30)));
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

