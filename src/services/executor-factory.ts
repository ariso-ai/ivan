import { ClaudeExecutor } from './claude-executor.js';
import { ClaudeCliExecutor } from './claude-cli-executor.js';
import { ConfigManager } from '../config.js';

/**
 * Appended to every turn's system prompt. Ivan runs unattended: the moment the
 * turn ends it commits, pushes, and opens a PR — any work still running in the
 * background (subagents, background shells) is silently lost, which surfaces
 * as an empty branch and a failed `gh pr create`.
 */
export const NO_BACKGROUND_WORK_PROMPT =
  'You are running unattended inside an automation pipeline. The moment your ' +
  'turn ends, your work is committed and a pull request is opened — nothing ' +
  'running in the background survives past your final message. Therefore: ' +
  'never run agents, subtasks, or shell commands in the background ' +
  '(run_in_background must always be false), never defer work with phrases ' +
  "like \"I'll report back\" or \"running in the background\", and never end " +
  'your turn until every part of the task is fully implemented.';

export interface TurnResult {
  log: string;
  lastMessage: string;
  sessionId: string;
}

export interface TurnOptions {
  /** Resume an existing Claude session to preserve conversational context. */
  sessionId?: string;
  /** Permission mode for this turn. 'plan' prevents edits (design dialogue). */
  permissionMode?: 'plan' | 'acceptEdits' | 'bypassPermissions';
  /** Optional system prompt to shape the turn (e.g. the architect persona). */
  systemPrompt?: string;
  /** Override the configured model for this turn (e.g. the architect model). */
  model?: string;
  /**
   * When true, disallow file-mutating tools (Edit/Write/NotebookEdit) so the
   * session can read, grep, and inspect but not modify the worktree. Used for
   * the architect/reviewer role.
   */
  readOnly?: boolean;
}

export interface IClaudeExecutor {
  quietMode: boolean;
  executeTask(
    taskDescription: string,
    workingDir: string,
    sessionId?: string
  ): Promise<TurnResult>;
  /**
   * Execute a single conversational turn with fine-grained control over
   * session continuity, permission mode, system prompt, model, and tool access.
   * `executeTask` is a thin wrapper over this with implementer defaults.
   */
  executeTurn(
    prompt: string,
    workingDir: string,
    options?: TurnOptions
  ): Promise<TurnResult>;
  generateTaskBreakdown(
    jobDescription: string,
    workingDir: string
  ): Promise<string[]>;
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
