import { query } from '@anthropic-ai/claude-code';
import chalk from 'chalk';
import { ConfigManager } from '../config.js';

export class ClaudeExecutor {
  private configManager: ConfigManager;

  constructor() {
    this.configManager = new ConfigManager();
  }

  private async getApiKey(): Promise<string> {
    let config = this.configManager.getConfig();
    
    if (!config?.anthropicApiKey || config.anthropicApiKey === '') {
      // Prompt for the API key
      const apiKey = await this.configManager.promptForMissingConfig('anthropicApiKey');
      config = this.configManager.getConfig();
    }
    
    if (!config?.anthropicApiKey) {
      throw new Error('Failed to obtain Anthropic API key');
    }
    
    return config.anthropicApiKey;
  }

  async executeTask(taskDescription: string, workingDir: string): Promise<string> {
    console.log(chalk.blue(`🤖 Executing task with Claude Code: ${taskDescription}`));
    console.log(chalk.yellow('💡 Press Ctrl+C to cancel the task'));

    try {
      // Set the API key in environment for the SDK
      process.env.ANTHROPIC_API_KEY = await this.getApiKey();

      console.log(chalk.gray(`Working directory: ${workingDir}`));
      console.log(chalk.yellow('⏳ Starting Claude Code execution...'));

      let result = '';
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
            abortController,
            allowedTools: ['*'], // Allow all tools
            cwd: workingDir
          }
        })) {
          // Handle different message types based on the SDK types
          if (message.type === 'assistant') {
            // Assistant messages contain the actual content
            if (message.message.content) {
              for (const content of message.message.content) {
                if (content.type === 'text') {
                  console.log(content.text);
                  result += content.text + '\n';
                } else if (content.type === 'tool_use') {
                  console.log(chalk.gray(`Using tool: ${content.name}`));
                }
              }
            }
          } else if (message.type === 'result') {
            // Final result message
            if ('result' in message) {
              console.log(chalk.green(`Result: ${message.result}`));
              result += message.result + '\n';
            }
          } else if (message.type === 'system') {
            // System messages for initialization
            if (message.subtype === 'init') {
              console.log(chalk.gray(`Initialized with model: ${message.model}`));
            }
          }
        }

        // Restore original directory
        process.chdir(originalDir);
      } finally {
        process.removeListener('SIGINT', handleInterrupt);
      }

      console.log(chalk.green('✅ Claude Code execution completed'));
      return result;

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

        // Generate task breakdown using the SDK
        for await (const message of query({
          prompt,
          options: {
            abortController,
            customSystemPrompt: 'You are a task breakdown generator. Respond only with a newline-separated list of tasks.',
            allowedTools: [], // No tools needed for this
            cwd: workingDir
          }
        })) {
          // Handle different message types
          if (message.type === 'assistant') {
            // Assistant messages contain the actual content
            if (message.message.content) {
              for (const content of message.message.content) {
                if (content.type === 'text') {
                  taskList += content.text;
                }
              }
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
