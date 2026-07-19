import { spawn } from 'child_process';
import chalk from 'chalk';
import { ConfigManager } from '../config.js';
import path from 'path';
import { execSync } from 'child_process';
import type {
  IClaudeExecutor,
  TurnOptions,
  TurnResult
} from './executor-factory.js';
import {
  InterjectionManager,
  appendInterjections,
  interjectionMessage
} from './interjection-manager.js';

export class ClaudeCliExecutor implements IClaudeExecutor {
  public quietMode: boolean = false;
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

  async executeTask(
    taskDescription: string,
    workingDir: string,
    sessionId?: string
  ): Promise<TurnResult> {
    return this.executeTurn(taskDescription, workingDir, {
      sessionId,
      permissionMode: 'bypassPermissions'
    });
  }

  async executeTurn(
    taskDescription: string,
    workingDir: string,
    options: TurnOptions = {}
  ): Promise<TurnResult> {
    const {
      sessionId,
      permissionMode = 'bypassPermissions',
      systemPrompt,
      model: modelOverride,
      readOnly = false
    } = options;

    console.log(
      chalk.blue(`🤖 Executing task with Claude Code CLI: ${taskDescription}`)
    );
    console.log(chalk.yellow('💡 Press Ctrl+C to cancel the task'));

    // Check if Claude CLI is installed
    if (!this.checkClaudeCliInstalled()) {
      throw new Error(
        'Claude CLI is not installed. Please install it first or use the SDK executor.'
      );
    }

    try {
      // Determine the original repo path (in case we're in a worktree)
      let originalRepoPath = workingDir;

      // Check if we're in a worktree by looking for .git file (not directory)
      try {
        const gitPath = path.join(workingDir, '.git');
        const gitInfo = execSync(`cat "${gitPath}"`, {
          encoding: 'utf8'
        }).trim();
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
      let allowedTools =
        await this.configManager.getRepoAllowedTools(originalRepoPath);

      // Get repository-specific blocked tools
      const blockedTools =
        await this.configManager.getRepoBlockedTools(originalRepoPath);

      // Always block EnterPlanMode and AskUserQuestion globally. Also block
      // ExitPlanMode outside explicit plan-mode turns — otherwise the model can
      // call it to end the turn after only planning the change, with no edits.
      // In read-only (architect) turns, also block file-mutating tools.
      const globallyBlockedTools = [
        'EnterPlanMode',
        'AskUserQuestion',
        ...(permissionMode === 'plan' ? [] : ['ExitPlanMode']),
        ...(readOnly ? ['Edit', 'Write', 'NotebookEdit'] : [])
      ];

      // Combine globally blocked tools with repository-specific blocked tools
      const allBlockedTools = blockedTools
        ? [...new Set([...globallyBlockedTools, ...blockedTools])]
        : globallyBlockedTools;

      // Apply blocked tools
      if (allBlockedTools.length > 0) {
        if (!allowedTools || allowedTools.includes('*')) {
          // If all tools are allowed (default), create explicit list excluding blocked tools
          const allTools = [
            'Task',
            'AgentOutputTool',
            'Bash',
            'Glob',
            'Grep',
            'Read',
            'Edit',
            'Write',
            'NotebookEdit',
            'WebFetch',
            'TodoWrite',
            'WebSearch',
            'BashOutput',
            'KillShell',
            'Skill',
            'SlashCommand',
            ...(permissionMode === 'plan' ? ['ExitPlanMode'] : [])
          ];
          allowedTools = allTools.filter(
            (tool) => !allBlockedTools.includes(tool)
          );
        } else {
          // If specific tools are allowed, remove blocked ones
          allowedTools = allowedTools.filter(
            (tool) => !allBlockedTools.includes(tool)
          );
        }
      }

      // Get the selected model (architect turns may override it)
      const model = modelOverride || this.configManager.getClaudeModel();

      console.log(chalk.gray(`Working directory: ${workingDir}`));
      console.log(chalk.gray(`Model: ${model}`));
      if (allowedTools && allowedTools.length > 0) {
        console.log(chalk.gray(`Allowed tools: ${allowedTools.join(', ')}`));
      }
      console.log(chalk.yellow('⏳ Starting Claude Code CLI execution...'));

      const currentSessionId = sessionId || '';

      // Per-turn flags shared by the initial run and any interjection
      // follow-up runs. The prompt is always passed as the value of -p so it
      // can't be consumed by greedy multi-value flags like --disallowed-tools.
      const baseArgs: string[] = [
        '--model',
        model,
        '--permission-mode',
        permissionMode
      ];

      // Add an architect/reviewer persona or other per-turn system prompt
      if (systemPrompt) {
        baseArgs.push('--append-system-prompt', systemPrompt);
      }

      // Add allowed tools if specified
      if (
        allowedTools &&
        allowedTools.length > 0 &&
        !allowedTools.includes('*')
      ) {
        baseArgs.push('--allowed-tools', ...allowedTools);
      }

      // Add disallowed tools to explicitly block them
      if (allBlockedTools.length > 0) {
        baseArgs.push('--disallowed-tools', ...allBlockedTools);
      }

      // Let the user interject with additional context while the task runs.
      // `claude -p` is non-interactive, so context typed during the run is
      // applied in an automatic follow-up turn on the same conversation.
      const interjections = InterjectionManager.getInstance();
      interjections.start(this.quietMode);
      try {
        const prompt = appendInterjections(
          taskDescription,
          interjections.drainPending()
        );
        const args = ['-p', prompt, ...baseArgs];

        // Add resume flag if we have a session ID
        if (sessionId) {
          args.push('--resume', sessionId);
        }

        const first = await this.runCliProcess(args, workingDir);
        let fullLog = first.output;
        let lastMessage = first.lastMessage;

        while (interjections.hasPending()) {
          console.log(
            chalk.cyan('↪ Applying the context you added during the run...')
          );
          // --continue resumes the most recent conversation in this working
          // directory (the run that just finished) — the CLI executor never
          // learns new session ids from -p output, so --resume can't be used.
          const followUpArgs = [
            '-p',
            interjectionMessage(interjections.drainPending()),
            ...baseArgs,
            '--continue'
          ];
          const followUp = await this.runCliProcess(followUpArgs, workingDir);
          fullLog += '\n' + followUp.output;
          lastMessage = followUp.lastMessage;
        }

        return { log: fullLog, lastMessage, sessionId: currentSessionId };
      } finally {
        interjections.stop();
      }
    } catch (error: unknown) {
      const err = error as Error & { message?: string };

      if (err.message?.includes('cancel')) {
        throw new Error('Task execution cancelled by user');
      }

      console.error(chalk.red('❌ Claude Code CLI execution failed:'));
      throw new Error(`Claude Code CLI execution failed: ${err.message}`);
    }
  }

  /** Spawns one `claude` CLI run, streaming its output in real time. */
  private runCliProcess(
    args: string[],
    workingDir: string
  ): Promise<{ output: string; lastMessage: string }> {
    return new Promise((resolve, reject) => {
      const claudeProcess = spawn('claude', args, {
        cwd: workingDir,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let fullOutput = '';
      let stderr = '';
      let lastMessage = '';

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
          resolve({ output: fullOutput, lastMessage });
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
  }

  async generateTaskBreakdown(
    jobDescription: string,
    workingDir: string
  ): Promise<string[]> {
    // Check if Claude CLI is installed
    if (!this.checkClaudeCliInstalled()) {
      throw new Error(
        'Claude CLI is not installed. Please install it first or use the SDK executor.'
      );
    }

    try {
      const prompt = `Return a new-line separated list of tasks you would do to best accomplish the following: '${jobDescription}'. Respond with ONLY the new line separated list, do not introduce the results. Each task should be considered as something that should be opened as a pull request. do NOT include tasks like searching, finding/locating files or researching, analyzing the codebase or looking for certain parts of the code.`;

      console.log(
        chalk.blue('🤖 Generating task breakdown with Claude Code CLI...')
      );
      console.log(chalk.yellow('💡 Press Ctrl+C to cancel'));
      console.log(chalk.gray(`Working directory: ${workingDir}`));

      // Get the selected model for consistency
      const model = this.configManager.getClaudeModel();

      // Build Claude CLI arguments for task breakdown
      const args: string[] = [
        '--print', // Non-interactive mode
        '--model',
        model,
        '--max-turns',
        '1', // Only one turn needed for task breakdown
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
            console.error(
              chalk.red(
                '❌ Failed to generate task breakdown with Claude Code CLI'
              )
            );
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
          console.log(
            chalk.yellow(
              '\n⚠️  Task breakdown generation cancelled by user (Ctrl+C)'
            )
          );
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

      console.error(
        chalk.red('❌ Failed to generate task breakdown with Claude Code CLI')
      );
      throw new Error(`Failed to generate task breakdown: ${err.message}`);
    }
  }

  async validateClaudeCodeInstallation(): Promise<void> {
    if (!this.checkClaudeCliInstalled()) {
      throw new Error(
        'Claude CLI is not installed. Install it from: https://docs.claude.com/en/docs/claude-code/installation'
      );
    }
    console.log(chalk.green('✅ Claude CLI is installed and ready to use'));
  }
}
