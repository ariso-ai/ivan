import { execSync, spawn } from 'child_process';
import chalk from 'chalk';

export class ClaudeExecutor {
  private executeWithSignalHandling(command: string, args: string[], options: { cwd?: string; timeout?: number; silent?: boolean }): Promise<string> {
    return new Promise((resolve, reject) => {
      // Build the full command properly
      let fullCommand: string;
      if (command === 'sh' && args[0] === '-c' && args[1]) {
        // Special handling for sh -c commands
        fullCommand = args[1];
      } else if (args.length > 0) {
        fullCommand = `${command} ${args.join(' ')}`;
      } else {
        fullCommand = command;
      }

      const child = spawn(fullCommand, [], {
        cwd: options.cwd,
        stdio: ['inherit', 'pipe', 'pipe'],  // inherit stdin to allow interactive commands
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
        const text = data.toString();
        stdout += text;
        // Stream output in real-time for better UX (unless silent mode)
        if (!options.silent) {
          process.stdout.write(text);
        }
      });

      child.stderr?.on('data', (data) => {
        const text = data.toString();
        stderr += text;
        // Stream errors in real-time (unless silent mode)
        if (!options.silent) {
          process.stderr.write(text);
        }
      });

      child.on('exit', (code, signal) => {
        // Use 'exit' instead of 'close' to ensure we catch the exit properly
        if (timeoutId) globalThis.clearTimeout(timeoutId);
        process.removeListener('SIGINT', cleanup);
        process.removeListener('SIGTERM', cleanup);

        if (isTerminated || signal === 'SIGINT' || signal === 'SIGTERM') {
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
    console.log(chalk.yellow('💡 Press Ctrl+C to cancel the task'));

    try {
      const escapedTask = taskDescription.replace(/"/g, '\\"');
      const claudeCommand = `claude --print "${escapedTask}" --verbose --dangerously-skip-permissions`;

      console.log(chalk.gray(`Running: ${claudeCommand}`));
      console.log(chalk.gray(`Working directory: ${workingDir}`));
      console.log(chalk.yellow('⏳ Starting Claude Code execution...'));

      const result = await this.executeWithSignalHandling('sh', ['-c', claudeCommand], {
        cwd: workingDir
      });

      console.log(chalk.green('✅ Claude Code execution completed'));

      // No need to print output again since it's already streamed
      return result || '';

    } catch (error: unknown) {
      const err = error as Error & { stdout?: string; stderr?: string; status?: number; signal?: string };

      // Check if it was interrupted by user
      if (err.message === 'Command was interrupted') {
        console.log(chalk.yellow('\n⚠️  Task cancelled by user (Ctrl+C)'));
        throw new Error('Task execution cancelled by user');
      }

      console.error(chalk.red('❌ Claude Code execution failed:'));
      let errorLog = `Claude Code execution failed: ${err.message}`;

      if (err.status) {
        console.log(chalk.red(`Exit code: ${err.status}`));
        errorLog += `\nExit code: ${err.status}`;
      }

      if (err.signal) {
        console.log(chalk.red(`Signal: ${err.signal}`));
        errorLog += `\nSignal: ${err.signal}`;
      }

      // Output is already streamed, so we don't need to print it again
      if (err.stdout) {
        errorLog += `\nSTDOUT: ${err.stdout}`;
      }

      if (err.stderr) {
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
      const prompt = `Return a new-line separated list of tasks you would do to best accomplish the following: '${jobDescription}'. Respond with ONLY the new line separated list, do not introduce the results.  Each task should be considered as something that should be opened as a pull request. do NOT include tasks like searching, finding/locating files or researching, analyzing the codebase or looking for certain parts of the code.`;
      const escapedPrompt = prompt.replace(/"/g, '\\"');
      const claudeCommand = `claude -p "${escapedPrompt}" --output-format json --dangerously-skip-permissions`;

      console.log(chalk.blue('🤖 Generating task breakdown with Claude Code...'));
      console.log(chalk.yellow('💡 Press Ctrl+C to cancel'));
      console.log(chalk.gray(`Running: ${claudeCommand}`));
      console.log(chalk.gray(`Working directory: ${workingDir}`));

      const result = await this.executeWithSignalHandling('sh', ['-c', claudeCommand], {
        cwd: workingDir
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
      const err = error as Error;

      // Check if it was interrupted by user
      if (err.message === 'Command was interrupted') {
        console.log(chalk.yellow('\n⚠️  Task breakdown generation cancelled by user (Ctrl+C)'));
        throw new Error('Task breakdown generation cancelled by user');
      }

      console.error(chalk.red('❌ Failed to generate task breakdown with Claude Code'));
      throw new Error(`Failed to generate task breakdown: ${err.message}`);
    }
  }

  validateClaudeCodeInstallation(): void {
    if (!this.isClaudeCodeInstalled()) {
      throw new Error('Claude Code CLI is not installed or not in PATH. Please install it first.');
    }
  }
}

