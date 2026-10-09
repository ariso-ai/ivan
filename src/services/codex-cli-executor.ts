import { spawn } from 'child_process';
import { execSync } from 'child_process';
import chalk from 'chalk';
import { ConfigManager } from '../config.js';
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

/**
 * Drives the OpenAI Codex CLI (`codex exec`) through the same IClaudeExecutor
 * interface the Claude executors implement, so every workflow (build tasks,
 * PR-comment addressing, reviews, risk analysis, expert mode) can run on Codex
 * unchanged.
 *
 * Mapping of Claude concepts onto Codex:
 * - permissionMode 'plan' / readOnly turns → `--sandbox read-only` (Codex has
 *   no plan mode; a read-only sandbox likewise prevents any edits).
 * - permissionMode 'bypassPermissions' → `--dangerously-bypass-approvals-and-sandbox`
 *   (exec mode is non-interactive, so approvals can never be answered anyway).
 * - systemPrompt → prepended to the user prompt (Codex exec has no
 *   append-system-prompt flag).
 * - sessionId → the Codex thread id, resumed with `codex exec resume <id>`.
 * - allowed/blocked tool lists are Claude-specific and are not applied.
 */
export class CodexCliExecutor implements IClaudeExecutor {
  public quietMode: boolean = false;
  private configManager: ConfigManager;

  constructor() {
    this.configManager = new ConfigManager();
  }

  private checkCodexCliInstalled(): boolean {
    try {
      execSync('which codex', { stdio: 'ignore' });
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

    if (!this.quietMode) {
      console.log(
        chalk.blue(`🤖 Executing task with Codex CLI: ${taskDescription}`)
      );
      console.log(chalk.yellow('💡 Press Ctrl+C to cancel the task'));
    }

    if (!this.checkCodexCliInstalled()) {
      throw new Error(
        'Codex CLI is not installed. Install it with: npm install -g @openai/codex'
      );
    }

    const model = modelOverride || this.configManager.getCodexModel();
    const restricted = readOnly || permissionMode === 'plan';

    // Per-turn flags shared by the initial run and any interjection follow-up
    // runs. The prompt is always the final positional argument. No --model
    // unless one was explicitly configured — the Codex CLI's own default is
    // the only value guaranteed to be available on the user's plan.
    const baseArgs: string[] = ['--json', ...(model ? ['--model', model] : [])];
    // `codex exec` takes --sandbox, but `codex exec resume` does not — there
    // the sandbox must be set via the -c config-override form instead.
    const sandboxArgs = restricted
      ? ['--sandbox', 'read-only']
      : ['--dangerously-bypass-approvals-and-sandbox'];
    const resumeSandboxArgs = restricted
      ? ['-c', 'sandbox_mode="read-only"']
      : ['--dangerously-bypass-approvals-and-sandbox'];

    if (!this.quietMode) {
      console.log(chalk.gray(`Working directory: ${workingDir}`));
      console.log(chalk.gray(`Model: ${model || '(codex default)'}`));
      console.log(
        chalk.gray(`Sandbox: ${restricted ? 'read-only' : 'full access'}`)
      );
      console.log(chalk.yellow('⏳ Starting Codex CLI execution...'));
    }

    // Let the user interject with additional context while the task runs.
    // `codex exec` is non-interactive, so context typed during the run is
    // applied in an automatic follow-up turn on the same Codex thread.
    const interjections = InterjectionManager.getInstance();
    interjections.start(this.quietMode);
    try {
      const prompt = this.composePrompt(
        appendInterjections(taskDescription, interjections.drainPending()),
        systemPrompt
      );

      const initialArgs = sessionId
        ? [
            'exec',
            'resume',
            sessionId,
            ...baseArgs,
            ...resumeSandboxArgs,
            prompt
          ]
        : ['exec', ...baseArgs, ...sandboxArgs, prompt];

      const first = await this.runCodexProcess(initialArgs, workingDir);
      let fullLog = first.output;
      let lastMessage = first.lastMessage;
      let threadId = first.threadId || sessionId || '';

      while (interjections.hasPending()) {
        if (!this.quietMode) {
          console.log(
            chalk.cyan('↪ Applying the context you added during the run...')
          );
        }
        const followUpPrompt = this.composePrompt(
          interjectionMessage(interjections.drainPending()),
          systemPrompt
        );
        // Resume the thread that just finished; fall back to --last when the
        // thread id was not surfaced in the JSON stream.
        const resumeTarget = threadId ? [threadId] : ['--last'];
        const followUp = await this.runCodexProcess(
          [
            'exec',
            'resume',
            ...resumeTarget,
            ...baseArgs,
            ...resumeSandboxArgs,
            followUpPrompt
          ],
          workingDir
        );
        fullLog += '\n' + followUp.output;
        lastMessage = followUp.lastMessage;
        threadId = followUp.threadId || threadId;
      }

      return { log: fullLog, lastMessage, sessionId: threadId };
    } catch (error: unknown) {
      const err = error as Error & { message?: string };

      if (err.message?.includes('cancel')) {
        throw new Error('Task execution cancelled by user');
      }

      if (!this.quietMode)
        console.error(chalk.red('❌ Codex CLI execution failed:'));
      throw new Error(`Codex CLI execution failed: ${err.message}`);
    } finally {
      interjections.stop();
    }
  }

  /**
   * Codex exec has no per-turn system-prompt flag, so persona/system
   * instructions are prepended to the user prompt instead.
   */
  private composePrompt(prompt: string, systemPrompt?: string): string {
    if (!systemPrompt) return prompt;
    return `<system_instructions>\n${systemPrompt}\n</system_instructions>\n\n${prompt}`;
  }

  /**
   * Spawns one `codex exec` run in JSON mode, streaming readable progress to
   * the console while accumulating a log, the final agent message, and the
   * thread id (Codex's session id, used for resume).
   */
  private runCodexProcess(
    args: string[],
    workingDir: string
  ): Promise<{ output: string; lastMessage: string; threadId: string }> {
    return new Promise((resolve, reject) => {
      const codexProcess = spawn('codex', args, {
        cwd: workingDir,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let output = '';
      let stderr = '';
      let lastMessage = '';
      let threadId = '';
      let stdoutBuffer = '';

      const appendLog = (text: string) => {
        output += text + '\n';
      };

      const handleEvent = (event: Record<string, unknown>) => {
        // Newer Codex CLI JSON stream: thread.started / item.completed events.
        if (event.type === 'thread.started') {
          const id = event.thread_id;
          if (typeof id === 'string') threadId = id;
          return;
        }
        if (event.type === 'error') {
          const message =
            typeof event.message === 'string' ? event.message : 'unknown error';
          appendLog(`[Error] ${message}`);
          if (!this.quietMode) console.error(chalk.red(message));
          return;
        }
        if (event.type === 'item.completed') {
          const item = event.item as Record<string, unknown> | undefined;
          if (!item) return;
          if (item.type === 'agent_message' && typeof item.text === 'string') {
            console.log(item.text);
            appendLog(item.text);
            lastMessage = item.text;
          } else if (
            item.type === 'command_execution' &&
            typeof item.command === 'string'
          ) {
            if (!this.quietMode)
              console.log(chalk.gray(`Running: ${item.command}`));
            appendLog(`[Command: ${item.command}]`);
          } else if (item.type === 'file_change') {
            const changes = Array.isArray(item.changes)
              ? (item.changes as { path?: string }[])
                  .map((c) => c.path)
                  .filter(Boolean)
                  .join(', ')
              : '';
            if (!this.quietMode)
              console.log(chalk.gray(`Edited: ${changes || '(files)'}`));
            appendLog(`[File change: ${changes || '(files)'}]`);
          } else if (
            item.type === 'error' &&
            typeof item.message === 'string'
          ) {
            appendLog(`[Error] ${item.message}`);
            if (!this.quietMode) console.error(chalk.red(item.message));
          }
          return;
        }
        // Older Codex CLI JSON stream: {"id":..., "msg":{"type": ...}}.
        const msg = event.msg as Record<string, unknown> | undefined;
        if (!msg) return;
        if (
          msg.type === 'session_configured' &&
          typeof msg.session_id === 'string'
        ) {
          threadId = msg.session_id;
        } else if (
          msg.type === 'agent_message' &&
          typeof msg.message === 'string'
        ) {
          console.log(msg.message);
          appendLog(msg.message);
          lastMessage = msg.message;
        } else if (msg.type === 'error' && typeof msg.message === 'string') {
          appendLog(`[Error] ${msg.message}`);
          if (!this.quietMode) console.error(chalk.red(msg.message));
        }
      };

      const consumeLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        try {
          handleEvent(JSON.parse(trimmed) as Record<string, unknown>);
        } catch {
          // Non-JSON output (banners, warnings): keep it in the log verbatim.
          appendLog(trimmed);
          if (!this.quietMode) console.log(chalk.gray(trimmed));
        }
      };

      codexProcess.stdout.on('data', (data) => {
        stdoutBuffer += data.toString();
        const lines = stdoutBuffer.split('\n');
        stdoutBuffer = lines.pop() ?? '';
        lines.forEach(consumeLine);
      });

      codexProcess.stderr.on('data', (data) => {
        const text = data.toString();
        stderr += text;
        if (!this.quietMode) process.stderr.write(chalk.gray(text));
      });

      codexProcess.on('close', (code) => {
        if (stdoutBuffer.trim()) consumeLine(stdoutBuffer);
        process.removeListener('SIGINT', handleInterrupt);
        if (code === 0) {
          if (!this.quietMode)
            console.log(chalk.green('✅ Codex CLI execution completed'));
          resolve({ output, lastMessage, threadId });
        } else {
          if (!this.quietMode) {
            console.error(chalk.red('❌ Codex CLI execution failed'));
            if (stderr) console.error(chalk.red('Error output:'), stderr);
          }
          reject(new Error(`Codex CLI exited with code ${code}: ${stderr}`));
        }
      });

      codexProcess.on('error', (error) => {
        process.removeListener('SIGINT', handleInterrupt);
        if (!this.quietMode)
          console.error(chalk.red('❌ Failed to start Codex CLI'));
        reject(new Error(`Failed to start Codex CLI: ${error.message}`));
      });

      const handleInterrupt = () => {
        codexProcess.kill('SIGINT');
        console.log(chalk.yellow('\n⚠️  Task cancelled by user (Ctrl+C)'));
        reject(new Error('Task execution cancelled by user'));
      };
      process.on('SIGINT', handleInterrupt);
    });
  }

  async generateTaskBreakdown(
    jobDescription: string,
    workingDir: string
  ): Promise<string[]> {
    if (!this.checkCodexCliInstalled()) {
      throw new Error(
        'Codex CLI is not installed. Install it with: npm install -g @openai/codex'
      );
    }

    const prompt = `Return a new-line separated list of tasks you would do to best accomplish the following: '${jobDescription}'. Respond with ONLY the new line separated list, do not introduce the results. Each task should be considered as something that should be opened as a pull request. do NOT include tasks like searching, finding/locating files or researching, analyzing the codebase or looking for certain parts of the code.`;

    console.log(chalk.blue('🤖 Generating task breakdown with Codex CLI...'));
    console.log(chalk.yellow('💡 Press Ctrl+C to cancel'));
    console.log(chalk.gray(`Working directory: ${workingDir}`));

    const model = this.configManager.getCodexModel();

    try {
      const result = await this.runCodexProcess(
        [
          'exec',
          '--json',
          ...(model ? ['--model', model] : []),
          '--sandbox',
          'read-only',
          prompt
        ],
        workingDir
      );

      const taskList = result.lastMessage || result.output;
      if (!taskList.trim()) {
        throw new Error('No task list returned from Codex CLI');
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

      if (err.message?.includes('cancel')) {
        throw new Error('Task breakdown generation cancelled by user');
      }

      console.error(
        chalk.red('❌ Failed to generate task breakdown with Codex CLI')
      );
      throw new Error(`Failed to generate task breakdown: ${err.message}`);
    }
  }

  async validateClaudeCodeInstallation(): Promise<void> {
    if (!this.checkCodexCliInstalled()) {
      throw new Error(
        'Codex CLI is not installed. Install it with: npm install -g @openai/codex (or brew install codex)'
      );
    }
    console.log(chalk.green('✅ Codex CLI is installed and ready to use'));
  }
}
