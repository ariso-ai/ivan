import { query } from '@anthropic-ai/claude-agent-sdk';
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
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

export class ClaudeExecutor implements IClaudeExecutor {
  public quietMode: boolean = false;
  private configManager: ConfigManager;

  constructor() {
    this.configManager = new ConfigManager();
  }

  private async getApiKey(): Promise<string> {
    let config = this.configManager.getConfig();

    if (!config?.anthropicApiKey || config.anthropicApiKey === '') {
      // Prompt for the API key
      await this.configManager.promptForMissingConfig('anthropicApiKey');
      config = this.configManager.getConfig();
    }

    if (!config?.anthropicApiKey) {
      throw new Error('Failed to obtain Anthropic API key');
    }

    return config.anthropicApiKey;
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
        chalk.blue(`🤖 Executing task with Claude Code: ${taskDescription}`)
      );
      console.log(chalk.yellow('💡 Press Ctrl+C to cancel the task'));
    }

    try {
      // Set the API key in environment for the SDK
      process.env.ANTHROPIC_API_KEY = await this.getApiKey();

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
      // In read-only (architect) turns, also block file-mutating tools so the
      // reviewer can inspect the worktree without changing it.
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

      if (!this.quietMode) {
        console.log(chalk.gray(`Working directory: ${workingDir}`));
        console.log(chalk.gray(`Model: ${model}`));
        if (allowedTools && allowedTools.length > 0) {
          console.log(chalk.gray(`Allowed tools: ${allowedTools.join(', ')}`));
        }
        console.log(chalk.yellow('⏳ Starting Claude Code execution...'));
      }

      let result = '';
      let currentResponse = '';
      let lastMessage = '';
      let currentSessionId = sessionId; // Move this outside the try block
      const abortController = new globalThis.AbortController();

      // Handle Ctrl+C
      const handleInterrupt = () => {
        abortController.abort();
        if (!this.quietMode)
          console.log(chalk.yellow('\n⚠️  Task cancelled by user (Ctrl+C)'));
      };
      process.on('SIGINT', handleInterrupt);

      // Let the user interject with additional context while the task runs
      // (like an interactive Claude Code session). Interjections are streamed
      // into the live session mid-turn via streaming input mode.
      const interjections = InterjectionManager.getInstance();
      interjections.start(this.quietMode);
      const streamingInput = interjections.isAvailable();
      let inputDone = false;
      let wake: (() => void) | null = null;
      const wakeUp = () => {
        const w = wake;
        wake = null;
        w?.();
      };
      const liveQueue: string[] = [];
      // Interjections streamed to the SDK mid-turn may be absorbed into the
      // running turn (one result covers both) or queued as the next turn
      // (their own result follows). Count what we streamed so the result
      // handler knows it can't just break on the first result it sees.
      let unansweredInterjections = 0;
      const releaseLive = interjections.setLiveListener((text) => {
        liveQueue.push(text);
        wakeUp();
      });

      // Include anything the user typed before this turn started listening.
      const initialPrompt = appendInterjections(
        taskDescription,
        interjections.drainPending()
      );

      const makeUserMessage = (text: string): SDKUserMessage => ({
        type: 'user',
        message: { role: 'user', content: text },
        parent_tool_use_id: null,
        session_id: currentSessionId || ''
      });

      // Streaming-input mode: yield the task, then forward interjections into
      // the live session as they arrive. Ends once the turn completes with no
      // queued input (inputDone is set by the consuming loop below).
      async function* promptStream(): AsyncGenerator<SDKUserMessage> {
        yield makeUserMessage(initialPrompt);
        for (;;) {
          if (liveQueue.length > 0) {
            unansweredInterjections++;
            yield makeUserMessage(interjectionMessage(liveQueue.splice(0)));
            continue;
          }
          if (inputDone) return;
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        }
      }

      try {
        // Change to working directory
        const originalDir = process.cwd();
        process.chdir(workingDir);

        // Execute the task using the SDK
        for await (const message of query({
          prompt: streamingInput ? promptStream() : initialPrompt,
          options: {
            abortController: abortController,
            // 1) Point Claude at the exact worktree it should edit:
            cwd: workingDir,

            // 2) (Optional) If you sometimes hop folders, explicitly whitelist them:
            additionalDirectories: [workingDir],

            // 3) Permission mode: 'plan' for design dialogue (no edits),
            //    'bypassPermissions' for implementation turns.
            permissionMode,

            // Load user (~/.claude), project (.claude/settings.json), and local
            // settings so hooks configured there are honored (the SDK skips
            // filesystem settings by default).
            settingSources: ['user', 'project', 'local'],
            ...(systemPrompt !== undefined && { systemPrompt }),
            ...(allowedTools !== undefined && { allowedTools }),
            disallowedTools: allBlockedTools,
            model: model,
            // Resume from previous session if provided
            ...(sessionId !== undefined && { resume: sessionId })
          }
        })) {
          // Handle different message types based on the SDK types
          if (message.type === 'assistant') {
            // Assistant messages contain the actual content
            if (message.message.content) {
              for (const content of message.message.content) {
                if (content.type === 'text') {
                  console.log(content.text);
                  currentResponse += content.text + '\n';
                  lastMessage = content.text; // Also capture text responses as last message
                } else if (content.type === 'tool_use') {
                  if (!this.quietMode)
                    console.log(chalk.gray(`Using tool: ${content.name}`));
                  // Add tool call to the log
                  const toolCall = `[Tool Call: ${content.name}]`;
                  if (content.input) {
                    const inputStr =
                      typeof content.input === 'object'
                        ? JSON.stringify(content.input, null, 2)
                        : String(content.input);
                    currentResponse += `${toolCall}\n${inputStr}\n\n`;
                  } else {
                    currentResponse += `${toolCall}\n\n`;
                  }
                }
              }
            }
          } else if (message.type === 'stream_event') {
            // Stream events may contain tool results. The SDK's typed event
            // union doesn't include 'tool_result', so widen for this check.
            const streamEvent =
              'event' in message
                ? (message.event as { type?: string; result?: unknown })
                : undefined;
            if (streamEvent?.type === 'tool_result') {
              const toolResult = `[Tool Result]\n${
                typeof streamEvent.result === 'object'
                  ? JSON.stringify(streamEvent.result, null, 2)
                  : String(streamEvent.result)
              }\n`;
              currentResponse += toolResult;
              // Add separation after tool result for next Claude response
              if (currentResponse.trim()) {
                result += currentResponse + '\n' + '─'.repeat(80) + '\n\n';
                currentResponse = '';
              }
            }
          } else if (message.type === 'result') {
            // Final result message
            if ('result' in message) {
              if (!this.quietMode)
                console.log(chalk.green(`Result: ${message.result}`));
              currentResponse += message.result + '\n';
              lastMessage = message.result; // Capture the last message
            }
            // In streaming-input mode the query stays open for more input
            // after each completed turn. Decide how to end it:
            if (streamingInput) {
              if (liveQueue.length > 0) {
                // An interjection is queued but not yet delivered — it will
                // start the next turn, so keep the query open.
              } else if (unansweredInterjections > 0) {
                // Interjections were streamed into the turn that just
                // finished. The CLI either absorbed them into that turn (no
                // further result is coming) or queued them as a follow-up
                // turn (another result will arrive) — we can't tell which.
                // End our input and drain instead of breaking: stdin EOF
                // makes the CLI finish any queued turn and exit, which ends
                // this loop either way.
                unansweredInterjections = 0;
                inputDone = true;
                wakeUp();
              } else {
                inputDone = true;
                wakeUp();
                break;
              }
            }
          } else if (message.type === 'system') {
            // System messages for initialization
            if (message.subtype === 'init') {
              if (!this.quietMode)
                console.log(
                  chalk.gray(`Initialized with model: ${message.model}`)
                );
              result += `[System: Initialized with model: ${message.model}]\n\n`;
              // Extract session ID from the system message if available
              if (
                'session_id' in message &&
                typeof message.session_id === 'string'
              ) {
                currentSessionId = message.session_id;
              }
            }
          } else if (
            'session_id' in message &&
            typeof message.session_id === 'string'
          ) {
            // Capture session ID from any message that has it
            currentSessionId = message.session_id;
          }
        }

        // Add any remaining response
        if (currentResponse.trim()) {
          result += currentResponse + '\n' + '─'.repeat(80) + '\n\n';
        }

        // Restore original directory
        process.chdir(originalDir);
      } finally {
        inputDone = true;
        wakeUp();
        releaseLive();
        // Keep anything typed too late to stream for the next turn instead
        // of dropping it.
        interjections.requeue(liveQueue.splice(0));
        interjections.stop();
        process.removeListener('SIGINT', handleInterrupt);
      }

      if (!this.quietMode)
        console.log(chalk.green('✅ Claude Code execution completed'));
      return { log: result, lastMessage, sessionId: currentSessionId || '' };
    } catch (error: unknown) {
      const err = error as Error & { message?: string };

      if (err.message?.includes('abort')) {
        throw new Error('Task execution cancelled by user');
      }

      if (!this.quietMode)
        console.error(chalk.red('❌ Claude Code execution failed:'));
      throw new Error(`Claude Code execution failed: ${err.message}`);
    }
  }

  async generateTaskBreakdown(
    jobDescription: string,
    workingDir: string
  ): Promise<string[]> {
    try {
      // Set the API key in environment for the SDK
      process.env.ANTHROPIC_API_KEY = await this.getApiKey();

      const prompt = `Return a new-line separated list of tasks you would do to best accomplish the following: '${jobDescription}'. Respond with ONLY the new line separated list, do not introduce the results. Each task should be considered as something that should be opened as a pull request. do NOT include tasks like searching, finding/locating files or researching, analyzing the codebase or looking for certain parts of the code.`;

      console.log(
        chalk.blue('🤖 Generating task breakdown with Claude Code...')
      );
      console.log(chalk.yellow('💡 Press Ctrl+C to cancel'));
      console.log(chalk.gray(`Working directory: ${workingDir}`));

      let taskList = '';
      const abortController = new globalThis.AbortController();

      // Handle Ctrl+C
      const handleInterrupt = () => {
        abortController.abort();
        console.log(
          chalk.yellow(
            '\n⚠️  Task breakdown generation cancelled by user (Ctrl+C)'
          )
        );
      };
      process.on('SIGINT', handleInterrupt);

      try {
        // Change to working directory
        const originalDir = process.cwd();
        process.chdir(workingDir);

        // Get the selected model for consistency
        const model = this.configManager.getClaudeModel();

        // Generate task breakdown using the SDK in plan mode
        for await (const message of query({
          prompt,
          options: {
            abortController,
            systemPrompt:
              'You are a task breakdown generator. Respond only with a newline-separated list of tasks.',
            cwd: workingDir,
            model: model,
            // Load user/project/local settings so hooks are honored
            settingSources: ['user', 'project', 'local'],
            // Use plan mode for task breakdown
            permissionMode: 'plan'
            // No allowedTools restriction for task breakdown
          }
        })) {
          // Handle different message types
          if (message.type === 'assistant') {
            // Assistant messages contain the actual content
            if (message.message.content) {
              for (const content of message.message.content) {
                if (content.type === 'text') {
                  // Output Claude's message as it comes through
                  console.log(content.text);
                  taskList += content.text;
                } else if (content.type === 'tool_use') {
                  // Output tool usage information
                  console.log(chalk.gray(`Using tool: ${content.name}`));
                }
              }
            }
          } else if (message.type === 'system') {
            // System messages for initialization
            if (message.subtype === 'init') {
              console.log(
                chalk.gray(
                  `Initialized with model: ${message.model} in plan mode`
                )
              );
            }
          } else if (message.type === 'result') {
            // Final result message
            if ('result' in message) {
              taskList += message.result;
            }
          }
        }

        // Restore original directory
        process.chdir(originalDir);
      } finally {
        process.removeListener('SIGINT', handleInterrupt);
      }

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

      if (err.message?.includes('abort')) {
        throw new Error('Task breakdown generation cancelled by user');
      }

      console.error(
        chalk.red('❌ Failed to generate task breakdown with Claude Code')
      );
      throw new Error(`Failed to generate task breakdown: ${err.message}`);
    }
  }

  async validateClaudeCodeInstallation(): Promise<void> {
    // This will prompt for API key if missing
    await this.getApiKey();
  }
}
