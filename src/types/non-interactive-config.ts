export interface NonInteractiveConfig {
  /**
   * Task descriptions - can be a single task or multiple tasks
   */
  tasks: string[];

  /**
   * If a single task is provided, whether to generate subtasks from it
   * Only applicable when tasks.length === 1
   */
  generateSubtasks?: boolean;

  /**
   * PR strategy when multiple tasks are executed
   * - 'single': Create one PR for all tasks
   * - 'multiple': Create one PR per task (default)
   */
  prStrategy?: 'single' | 'multiple';

  /**
   * After completing tasks, wait 30 minutes for PR reviews and automatically address comments
   * Default: false
   */
  waitForComments?: boolean;

  /**
   * Optional: Repository path to execute tasks in
   * Defaults to current working directory
   */
  workingDir?: string;

  /**
   * Optional: Local branch Ivan should branch from before creating a worktree.
   * Defaults to "main".
   */
  baseBranch?: string;

  /**
   * Whether to rewrite verbose prompts before execution.
   * Uses GPT-4o-mini to strip noise (Slack metadata, assignee directives, boilerplate)
   * and reformat the ticket as a structured Task/Acceptance Criteria prompt for Claude Code.
   */
  rewritePrompt?: boolean;
}
