import { query } from '@anthropic-ai/claude-agent-sdk';
import chalk from 'chalk';
import { ConfigManager } from '../config.js';
import path from 'path';
import { execSync } from 'child_process';
import { IClaudeExecutor } from './executor-factory.js';

export class ClaudeExecutor implements IClaudeExecutor {
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

  async executeTask(taskDescription: string, workingDir: string, sessionId?: string): Promise<{ log: string; lastMessage: string; sessionId: string }> {
    console.log(chalk.blue(`🤖 Executing task with Claude Code: ${taskDescription}`));
    console.log(chalk.yellow('💡 Press Ctrl+C to cancel the task'));

    try {
      // Set the API key in environment for the SDK
      process.env.ANTHROPIC_API_KEY = await this.getApiKey();

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
      console.log(chalk.yellow('⏳ Starting Claude Code execution...'));

      let result = '';
      let currentResponse = '';
      let lastMessage = '';
      let currentSessionId = sessionId; // Move this outside the try block
      const abortController = new globalThis.AbortController();

      // Handle Ctrl+C
      const handleInterrupt = () => {
        abortController.abort();
        console.log(chalk.yellow('\n⚠️  Task cancelled by user (Ctrl+C)'));
      };
      process.on('SIGINT', handleInterrupt);

      try {
        // Change to working directory
        const originalDir = process.cwd();
        process.chdir(workingDir);

        // Execute the task using the SDK
        for await (const message of query({
          prompt: taskDescription,
          options: {
            abortController: abortController,
            // 1) Point Claude at the exact worktree it should edit:
            cwd: workingDir,

            // 2) (Optional) If you sometimes hop folders, explicitly whitelist them:
            additionalDirectories: [workingDir],

            // 3) Allow edit tools in headless mode:
            //    Use 'acceptEdits' for safer default; 'bypassPermissions' is most permissive.
            permissionMode: 'bypassPermissions',
            allowedTools: allowedTools,
            model: model,
            // Resume from previous session if provided
            resume: sessionId
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
                  console.log(chalk.gray(`Using tool: ${content.name}`));
                  // Add tool call to the log
                  const toolCall = `[Tool Call: ${content.name}]`;
                  if (content.input) {
                    const inputStr = typeof content.input === 'object'
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
            // Stream events may contain tool results
            if ('event' in message && message.event?.type === 'tool_result') {
              const toolResult = `[Tool Result]\n${typeof message.event.result === 'object'
                ? JSON.stringify(message.event.result, null, 2)
                : String(message.event.result)}\n`;
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
              console.log(chalk.green(`Result: ${message.result}`));
              currentResponse += message.result + '\n';
              lastMessage = message.result; // Capture the last message
            }
          } else if (message.type === 'system') {
            // System messages for initialization
            if (message.subtype === 'init') {
              console.log(chalk.gray(`Initialized with model: ${message.model}`));
              result += `[System: Initialized with model: ${message.model}]\n\n`;
              // Extract session ID from the system message if available
              if ('session_id' in message && typeof message.session_id === 'string') {
                currentSessionId = message.session_id;
              }
            }
          } else if ('session_id' in message && typeof message.session_id === 'string') {
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
        process.removeListener('SIGINT', handleInterrupt);
      }

      console.log(chalk.green('✅ Claude Code execution completed'));
      return { log: result, lastMessage, sessionId: currentSessionId || '' };

    } catch (error: unknown) {
      const err = error as Error & { message?: string };

      if (err.message?.includes('abort')) {
        throw new Error('Task execution cancelled by user');
      }

      console.error(chalk.red('❌ Claude Code execution failed:'));
      throw new Error(`Claude Code execution failed: ${err.message}`);
    }
  }

  async generateTaskBreakdown(jobDescription: string, workingDir: string): Promise<string[]> {
    try {
      // Set the API key in environment for the SDK
      process.env.ANTHROPIC_API_KEY = await this.getApiKey();

      const prompt = `Return a new-line separated list of tasks you would do to best accomplish the following: '${jobDescription}'. Respond with ONLY the new line separated list, do not introduce the results. Each task should be considered as something that should be opened as a pull request. do NOT include tasks like searching, finding/locating files or researching, analyzing the codebase or looking for certain parts of the code.`;

      console.log(chalk.blue('🤖 Generating task breakdown with Claude Code...'));
      console.log(chalk.yellow('💡 Press Ctrl+C to cancel'));
      console.log(chalk.gray(`Working directory: ${workingDir}`));

      let taskList = '';
      const abortController = new globalThis.AbortController();

      // Handle Ctrl+C
      const handleInterrupt = () => {
        abortController.abort();
        console.log(chalk.yellow('\n⚠️  Task breakdown generation cancelled by user (Ctrl+C)'));
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
            systemPrompt: 'You are a task breakdown generator. Respond only with a newline-separated list of tasks.',
            cwd: workingDir,
            model: model,
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
              console.log(chalk.gray(`Initialized with model: ${message.model} in plan mode`));
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

      console.error(chalk.red('❌ Failed to generate task breakdown with Claude Code'));
      throw new Error(`Failed to generate task breakdown: ${err.message}`);
    }
  }

  async validateClaudeCodeInstallation(): Promise<void> {
    // This will prompt for API key if missing
    await this.getApiKey();
  }
}
