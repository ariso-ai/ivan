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
   * Whether to rewrite verbose prompts using a 3-step pipeline before execution.
   * Step 1: Extract research questions from ticket
   * Step 2: Objective codebase research (without the ticket, preventing intent leakage)
   * Step 3: Rewrite prompt using ticket + research
   */
  rewritePrompt?: boolean;
}
