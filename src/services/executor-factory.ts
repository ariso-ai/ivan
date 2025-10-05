import { ClaudeExecutor } from './claude-executor.js';
import { ClaudeCliExecutor } from './claude-cli-executor.js';
import { ConfigManager } from '../config.js';

export interface IClaudeExecutor {
  executeTask(taskDescription: string, workingDir: string, sessionId?: string): Promise<{ log: string; lastMessage: string; sessionId: string }>;
  generateTaskBreakdown(jobDescription: string, workingDir: string): Promise<string[]>;
  validateClaudeCodeInstallation(): Promise<void>;
}

export class ExecutorFactory {
  private static configManager = new ConfigManager();

  static getExecutor(): IClaudeExecutor {
    const executorType = this.configManager.getExecutorType();

    if (executorType === 'cli') {
      return new ClaudeCliExecutor();
    }

    return new ClaudeExecutor();
  }
}
