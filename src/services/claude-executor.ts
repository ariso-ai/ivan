import { execSync, spawn } from 'child_process';
import chalk from 'chalk';

export class ClaudeExecutor {
  private executeWithSignalHandling(command: string, args: string[], options: { cwd?: string; timeout?: number }): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: options.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true
      });

      let stdout = '';
      let stderr = '';
      let isTerminated = false;

      // Handle Ctrl+C and other signals
      const cleanup = () => {
        if (!isTerminated) {
          isTerminated = true;
          child.kill('SIGTERM');
          setTimeout(() => {
            if (!child.killed) {
              child.kill('SIGKILL');
            }
          }, 5000);
        }
      };

      // Forward signals to child process
      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);

      // Set timeout if provided
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      if (options.timeout) {
        timeoutId = setTimeout(() => {
          cleanup();
          reject(new Error('Command timed out'));
        }, options.timeout);
      }

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code, signal) => {
        if (timeoutId) globalThis.clearTimeout(timeoutId);
        process.removeListener('SIGINT', cleanup);
        process.removeListener('SIGTERM', cleanup);

        if (signal === 'SIGINT' || signal === 'SIGTERM') {
          reject(new Error('Command was interrupted'));
        } else if (code === 0) {
          resolve(stdout);
        } else {
          const error = new Error(`Command failed with code ${code}`) as Error & { stdout?: string; stderr?: string; status?: number };
          error.stdout = stdout;
          error.stderr = stderr;
          error.status = code || undefined;
          reject(error);
        }
      });

      child.on('error', (error) => {
        if (timeoutId) globalThis.clearTimeout(timeoutId);
        process.removeListener('SIGINT', cleanup);
        process.removeListener('SIGTERM', cleanup);
        reject(error);
      });
    });
  }
  async executeTask(taskDescription: string, workingDir: string): Promise<string> {
    console.log(chalk.blue(`🤖 Executing task with Claude Code: ${taskDescription}`));

    try {
      const escapedTask = taskDescription.replace(/"/g, '\\"');
      const claudeCommand = `claude --print "${escapedTask}" --verbose --dangerously-skip-permissions`;

      console.log(chalk.gray(`Running: ${claudeCommand}`));
      console.log(chalk.gray(`Working directory: ${workingDir}`));
      console.log(chalk.yellow('⏳ Starting Claude Code execution...'));

      const result = execSync(claudeCommand, {
        cwd: workingDir,
        encoding: 'utf8',
        stdio: 'pipe'
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

  async generateTaskBreakdown(jobDescription: string, workingDir: string): Promise<string[]> {
    try {
      const prompt = `Return a new-line separated list of tasks you would do to best accomplish the following: '${jobDescription}'. Respond with ONLY the new line separated list, do not introduce the results.  Each task should be considered as something that should be opened as a pull request, so don't include tasks like searching, finding/locating files or researching.`;
      const escapedPrompt = prompt.replace(/"/g, '\\"');
      const claudeCommand = `claude -p "${escapedPrompt}" --output-format json --dangerously-skip-permissions`;

      console.log(chalk.blue('🤖 Generating task breakdown with Claude Code...'));
      console.log(chalk.gray(`Running: ${claudeCommand}`));
      console.log(chalk.gray(`Working directory: ${workingDir}`));

      const result = execSync(claudeCommand, {
        cwd: workingDir,
        encoding: 'utf8',
        stdio: 'pipe'
      });

      const parsed = JSON.parse(result);
      const taskList = parsed.result || parsed.content || '';

      if (!taskList) {
        throw new Error('No task list returned from Claude Code');
      }

      const tasks = taskList
        .split('\n')
        .map((task: string) => task.trim())
        .filter((task: string) => task.length > 0)
        .map((task: string) => task.replace(/^\d+\.\s*/, '')) // Remove numbering like "1. "
        .map((task: string) => task.replace(/^-\s*/, '')); // Remove bullet points like "- "

      console.log(chalk.green(`✅ Generated ${tasks.length} tasks`));
      return tasks;

    } catch (error: unknown) {
      console.error(chalk.red('❌ Failed to generate task breakdown with Claude Code'));
      const err = error as Error;
      throw new Error(`Failed to generate task breakdown: ${err.message}`);
    }
  }

  validateClaudeCodeInstallation(): void {
    if (!this.isClaudeCodeInstalled()) {
      throw new Error('Claude Code CLI is not installed or not in PATH. Please install it first.');
    }
  }
}

