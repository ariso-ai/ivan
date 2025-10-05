import { spawn } from 'child_process';
import chalk from 'chalk';
import { ConfigManager } from '../config.js';
import path from 'path';
import { execSync } from 'child_process';
import { IClaudeExecutor } from './executor-factory.js';

export class ClaudeCliExecutor implements IClaudeExecutor {
  private configManager: ConfigManager;

  constructor() {
    this.configManager = new ConfigManager();
  }

  private checkClaudeCliInstalled(): boolean {
    try {
      execSync('which claude', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  async executeTask(taskDescription: string, workingDir: string, sessionId?: string): Promise<{ log: string; lastMessage: string; sessionId: string }> {
    console.log(chalk.blue(`🤖 Executing task with Claude Code CLI: ${taskDescription}`));
    console.log(chalk.yellow('💡 Press Ctrl+C to cancel the task'));

    // Check if Claude CLI is installed
    if (!this.checkClaudeCliInstalled()) {
      throw new Error('Claude CLI is not installed. Please install it first or use the SDK executor.');
    }

    try {
      // Determine the original repo path (in case we're in a worktree)
      let originalRepoPath = workingDir;

      // Check if we're in a worktree by looking for .git file (not directory)
      try {
        const gitPath = path.join(workingDir, '.git');
        const gitInfo = execSync(`cat "${gitPath}"`, { encoding: 'utf8' }).trim();
        if (gitInfo.startsWith('gitdir:')) {
          // We're in a worktree, extract the main repo path
          const gitDirPath = gitInfo.replace('gitdir:', '').trim();
          // Go up from .git/worktrees/<name> to get the main repo
          if (gitDirPath.includes('/worktrees/')) {
            originalRepoPath = path.resolve(gitDirPath, '../../..');
          }
        }
      } catch {
        // Not a worktree or couldn't determine, use workingDir as-is
      }

      // Get repository-specific allowed tools using the original repo path
      const allowedTools = await this.configManager.getRepoAllowedTools(originalRepoPath);

      // Get the selected model
      const model = this.configManager.getClaudeModel();

      console.log(chalk.gray(`Working directory: ${workingDir}`));
      console.log(chalk.gray(`Model: ${model}`));
      if (allowedTools && allowedTools.length > 0) {
        console.log(chalk.gray(`Allowed tools: ${allowedTools.join(', ')}`));
      }
      console.log(chalk.yellow('⏳ Starting Claude Code CLI execution...'));

      let lastMessage = '';
      const currentSessionId = sessionId || '';

      // Build Claude CLI arguments - options must come before the prompt
      const args: string[] = [
        '--print', // Non-interactive mode
        '--model', model,
        '--permission-mode', 'bypassPermissions' // Skip permission prompts
      ];

      // Add allowed tools if specified
      if (allowedTools && allowedTools.length > 0 && !allowedTools.includes('*')) {
        args.push('--allowed-tools', ...allowedTools);
      }

      // Add resume flag if we have a session ID
      if (sessionId) {
        args.push('--resume', sessionId);
      }

      // Add the task description as the last argument (after all options)
      args.push(taskDescription);

      return new Promise((resolve, reject) => {
        // Spawn the Claude CLI process with inherited stdio for real-time output
        const claudeProcess = spawn('claude', args, {
          cwd: workingDir,
          stdio: ['ignore', 'pipe', 'pipe']
        });

        let fullOutput = '';
        let stderr = '';

        // Handle stdout - stream output in real-time
        claudeProcess.stdout.on('data', (data) => {
          const output = data.toString();
          fullOutput += output;

          // Stream output directly to console in real-time
          process.stdout.write(output);

          // Track the last non-empty line as lastMessage
          const lines = output.split('\n').filter((line: string) => line.trim());
          if (lines.length > 0) {
            lastMessage = lines[lines.length - 1].trim();
          }
        });

        // Handle stderr - stream in real-time as well
        claudeProcess.stderr.on('data', (data) => {
          const output = data.toString();
          stderr += output;

          // Stream stderr to console (it may contain useful status info)
          process.stderr.write(chalk.gray(output));
        });

        // Handle process exit
        claudeProcess.on('close', (code) => {
          if (code === 0) {
            console.log(chalk.green('✅ Claude Code CLI execution completed'));
            resolve({ log: fullOutput, lastMessage, sessionId: currentSessionId });
          } else {
            console.error(chalk.red('❌ Claude Code CLI execution failed'));
            if (stderr) {
              console.error(chalk.red('Error output:'), stderr);
            }
            reject(new Error(`Claude CLI exited with code ${code}: ${stderr}`));
          }
        });

        // Handle process errors
        claudeProcess.on('error', (error) => {
          console.error(chalk.red('❌ Failed to start Claude CLI'));
          reject(new Error(`Failed to start Claude CLI: ${error.message}`));
        });

        // Handle Ctrl+C
        const handleInterrupt = () => {
          claudeProcess.kill('SIGINT');
          console.log(chalk.yellow('\n⚠️  Task cancelled by user (Ctrl+C)'));
          reject(new Error('Task execution cancelled by user'));
        };
        process.on('SIGINT', handleInterrupt);

        // Clean up handler when process exits
        claudeProcess.on('close', () => {
          process.removeListener('SIGINT', handleInterrupt);
        });
      });

    } catch (error: unknown) {
      const err = error as Error & { message?: string };

      if (err.message?.includes('cancel')) {
        throw new Error('Task execution cancelled by user');
      }

      console.error(chalk.red('❌ Claude Code CLI execution failed:'));
      throw new Error(`Claude Code CLI execution failed: ${err.message}`);
    }
  }

  async generateTaskBreakdown(jobDescription: string, workingDir: string): Promise<string[]> {
    // Check if Claude CLI is installed
    if (!this.checkClaudeCliInstalled()) {
      throw new Error('Claude CLI is not installed. Please install it first or use the SDK executor.');
    }

    try {
      const prompt = `Return a new-line separated list of tasks you would do to best accomplish the following: '${jobDescription}'. Respond with ONLY the new line separated list, do not introduce the results. Each task should be considered as something that should be opened as a pull request. do NOT include tasks like searching, finding/locating files or researching, analyzing the codebase or looking for certain parts of the code.`;

      console.log(chalk.blue('🤖 Generating task breakdown with Claude Code CLI...'));
      console.log(chalk.yellow('💡 Press Ctrl+C to cancel'));
      console.log(chalk.gray(`Working directory: ${workingDir}`));

      // Get the selected model for consistency
      const model = this.configManager.getClaudeModel();

      // Build Claude CLI arguments for task breakdown
      const args: string[] = [
        '--print', // Non-interactive mode
        '--model', model,
        '--max-turns', '1', // Only one turn needed for task breakdown
        prompt
      ];

      return new Promise((resolve, reject) => {
        // Spawn the Claude CLI process
        const claudeProcess = spawn('claude', args, {
          cwd: workingDir,
          stdio: ['pipe', 'pipe', 'pipe']
        });

        let taskList = '';
        let stderr = '';

        // Handle stdout - stream in real-time
        claudeProcess.stdout.on('data', (data) => {
          const output = data.toString();
          taskList += output;

          // Stream output directly to console in real-time
          process.stdout.write(output);
        });

        // Handle stderr - stream in real-time
        claudeProcess.stderr.on('data', (data) => {
          const output = data.toString();
          stderr += output;

          // Stream stderr to console
          process.stderr.write(chalk.gray(output));
        });

        // Handle process exit
        claudeProcess.on('close', (code) => {
          if (code === 0) {
            if (!taskList.trim()) {
              reject(new Error('No task list returned from Claude Code CLI'));
              return;
            }

            const tasks = taskList
              .split('\n')
              .map((task: string) => task.trim())
              .filter((task: string) => task.length > 0)
              .map((task: string) => task.replace(/^\d+\.\s*/, '')) // Remove numbering like "1. "
              .map((task: string) => task.replace(/^-\s*/, '')); // Remove bullet points like "- "

            console.log(chalk.green(`✅ Generated ${tasks.length} tasks`));
            resolve(tasks);
          } else {
            console.error(chalk.red('❌ Failed to generate task breakdown with Claude Code CLI'));
            if (stderr) {
              console.error(chalk.red('Error output:'), stderr);
            }
            reject(new Error(`Claude CLI exited with code ${code}: ${stderr}`));
          }
        });

        // Handle process errors
        claudeProcess.on('error', (error) => {
          console.error(chalk.red('❌ Failed to start Claude CLI'));
          reject(new Error(`Failed to start Claude CLI: ${error.message}`));
        });

        // Handle Ctrl+C
        const handleInterrupt = () => {
          claudeProcess.kill('SIGINT');
          console.log(chalk.yellow('\n⚠️  Task breakdown generation cancelled by user (Ctrl+C)'));
          reject(new Error('Task breakdown generation cancelled by user'));
        };
        process.on('SIGINT', handleInterrupt);

        // Clean up handler when process exits
        claudeProcess.on('close', () => {
          process.removeListener('SIGINT', handleInterrupt);
        });
      });

    } catch (error: unknown) {
      const err = error as Error;

      if (err.message?.includes('cancel')) {
        throw new Error('Task breakdown generation cancelled by user');
      }

      console.error(chalk.red('❌ Failed to generate task breakdown with Claude Code CLI'));
      throw new Error(`Failed to generate task breakdown: ${err.message}`);
    }
  }

  async validateClaudeCodeInstallation(): Promise<void> {
    if (!this.checkClaudeCliInstalled()) {
      throw new Error('Claude CLI is not installed. Install it from: https://docs.claude.com/en/docs/claude-code/installation');
    }
    console.log(chalk.green('✅ Claude CLI is installed and ready to use'));
  }
}
