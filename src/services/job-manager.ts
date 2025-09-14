import { randomUUID } from 'crypto';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { DatabaseManager, Job, Task } from '../database.js';
import { ClaudeExecutor } from './claude-executor.js';

export class JobManager {
  private dbManager: DatabaseManager;
  private claudeExecutor: ClaudeExecutor;
  private currentJobUuid: string | null = null;

  constructor() {
    this.dbManager = new DatabaseManager();
    this.claudeExecutor = new ClaudeExecutor();
  }

  async promptForTasks(workingDir: string): Promise<{ job: Job; tasks: Task[] }> {
    console.log(chalk.blue.bold('🎯 What would you like to work on today?'));
    console.log('');

    const { taskInput } = await inquirer.prompt([
      {
        type: 'editor',
        name: 'taskInput',
        message: 'Enter task(s) - one per line (press Enter to open editor):',
        default: '# Enter your tasks below (one per line)\n# Lines starting with # will be ignored\n\n',
        validate: (input: string) => {
          const cleanedInput = input
            .split('\n')
            .filter(line => line.trim() && !line.trim().startsWith('#'))
            .join('\n')
            .trim();

          if (!cleanedInput || cleanedInput.length === 0) {
            return 'Please enter at least one task';
          }
          return true;
        }
      }
    ]);

    // Parse newline-separated tasks, filtering out empty lines and comments
    const inputTasks = taskInput
      .split('\n')
      .map((task: string) => task.trim())
      .filter((task: string) => task.length > 0 && !task.startsWith('#'));

    let finalTasks = inputTasks;

    if (inputTasks.length === 1) {
      const { shouldBreakDown } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'shouldBreakDown',
          message: 'Would you like to break this task down into multiple smaller tasks?',
          default: false
        }
      ]);

      if (shouldBreakDown) {
        finalTasks = await this.generateTaskBreakdownWithClaude(inputTasks[0], workingDir);
      }
    } else if (inputTasks.length > 1) {
      // For manually entered multiple tasks, also offer selection
      console.log('');
      console.log(chalk.cyan('You entered the following tasks:'));
      inputTasks.forEach((task: string, index: number) => {
        console.log(chalk.gray(`  ${index + 1}. ${task}`));
      });
      console.log('');

      const { selectionMode } = await inquirer.prompt([
        {
          type: 'list',
          name: 'selectionMode',
          message: 'How would you like to proceed?',
          choices: [
            { name: 'Execute all tasks', value: 'all' },
            { name: 'Select specific tasks to execute', value: 'select' }
          ],
          default: 'all'
        }
      ]);

      if (selectionMode === 'select') {
        const { selectedTasks } = await inquirer.prompt<{ selectedTasks: string[] }>([
          {
            type: 'checkbox',
            name: 'selectedTasks',
            message: 'Select tasks to execute (use space to select, enter to confirm):',
            choices: inputTasks.map((task: string, index: number) => ({
              name: `${index + 1}. ${task}`,
              value: task,
              checked: true
            })),
            validate: (input: string[]) => {
              if (input.length === 0) {
                return 'Please select at least one task';
              }
              return true;
            }
          }
        ]);

        finalTasks = selectedTasks;
        console.log(chalk.green(`✅ Selected ${selectedTasks.length} task(s)`));
      }
    }

    // Create a clean description for the job (without comments)
    const jobDescription = finalTasks.length === 1
      ? finalTasks[0]
      : `${finalTasks.length} tasks: ${finalTasks.slice(0, 3).join('; ')}${finalTasks.length > 3 ? '...' : ''}`;

    const jobUuid = await this.createJob(jobDescription, workingDir);
    this.currentJobUuid = jobUuid;
    const tasks = await this.createTasks(jobUuid, finalTasks);

    const job: Job = {
      uuid: jobUuid,
      description: jobDescription,
      created_at: new Date().toISOString(),
      directory: workingDir
    };

    console.log('');
    console.log(chalk.green('✅ Job and tasks created successfully!'));
    console.log(chalk.cyan(`Job: ${job.description}`));
    console.log(chalk.cyan(`Tasks (${tasks.length}):`));
    tasks.forEach((task, index) => {
      console.log(chalk.gray(`  ${index + 1}. ${task.description}`));
    });

    return { job, tasks };
  }

  private async generateTaskBreakdownWithClaude(originalTask: string, workingDir: string): Promise<string[]> {
    console.log('');
    console.log(chalk.yellow('🤖 Using Claude Code to break down the task...'));
    console.log('');

    try {
      const tasks = await this.claudeExecutor.generateTaskBreakdown(originalTask, workingDir);

      if (tasks.length === 0) {
        console.log(chalk.red('Claude Code returned no tasks, falling back to original task'));
        return [originalTask];
      }

      console.log('');
      console.log(chalk.cyan('Generated tasks:'));
      tasks.forEach((task, index) => {
        console.log(chalk.gray(`  ${index + 1}. ${task}`));
      });
      console.log('');

      const { selectionMode } = await inquirer.prompt([
        {
          type: 'list',
          name: 'selectionMode',
          message: 'How would you like to proceed?',
          choices: [
            { name: 'Execute all tasks', value: 'all' },
            { name: 'Select specific tasks to execute', value: 'select' },
            { name: 'Use original task instead', value: 'original' }
          ],
          default: 'all'
        }
      ]);

      if (selectionMode === 'original') {
        console.log(chalk.yellow('Using original task instead'));
        return [originalTask];
      }

      if (selectionMode === 'select') {
        const { selectedTasks } = await inquirer.prompt<{ selectedTasks: string[] }>([
          {
            type: 'checkbox',
            name: 'selectedTasks',
            message: 'Select tasks to execute (use space to select, enter to confirm):',
            choices: tasks.map((task: string, index: number) => ({
              name: `${index + 1}. ${task}`,
              value: task,
              checked: true
            })),
            validate: (input: string[]) => {
              if (input.length === 0) {
                return 'Please select at least one task';
              }
              return true;
            }
          }
        ]);

        if (selectedTasks.length === 0) {
          console.log(chalk.yellow('No tasks selected, using original task'));
          return [originalTask];
        }

        console.log(chalk.green(`✅ Selected ${selectedTasks.length} task(s)`));
        return selectedTasks;
      }

      return tasks;

    } catch (error) {
      console.error(chalk.red('Failed to generate task breakdown:'), error);
      console.log(chalk.yellow('Falling back to original task'));
      return [originalTask];
    }
  }


  private async createTasks(jobUuid: string, taskDescriptions: string[]): Promise<Task[]> {
    const tasks: Task[] = taskDescriptions.map(description => ({
      uuid: randomUUID(),
      job_uuid: jobUuid,
      description,
      status: 'not_started' as const,
      pr_link: null,
      execution_log: null,
      branch: null,
      type: 'build' as const,
      comment_url: null,
      commit_sha: null
    }));

    const db = this.dbManager.getKysely();
    await db.insertInto('tasks').values(tasks).execute();

    return tasks;
  }

  async updateTaskStatus(taskUuid: string, status: Task['status']): Promise<void> {
    const db = this.dbManager.getKysely();
    await db
      .updateTable('tasks')
      .set({ status })
      .where('uuid', '=', taskUuid)
      .execute();
  }

  async updateTaskPrLink(taskUuid: string, prLink: string): Promise<void> {
    const db = this.dbManager.getKysely();
    await db
      .updateTable('tasks')
      .set({ pr_link: prLink })
      .where('uuid', '=', taskUuid)
      .execute();
  }

  async updateTaskExecutionLog(taskUuid: string, executionLog: string): Promise<void> {
    const db = this.dbManager.getKysely();
    await db
      .updateTable('tasks')
      .set({ execution_log: executionLog })
      .where('uuid', '=', taskUuid)
      .execute();
  }

  async updateTaskBranch(taskUuid: string, branch: string): Promise<void> {
    const db = this.dbManager.getKysely();
    await db
      .updateTable('tasks')
      .set({ branch })
      .where('uuid', '=', taskUuid)
      .execute();
  }

  async updateTaskCommentUrl(taskUuid: string, commentUrl: string): Promise<void> {
    const db = this.dbManager.getKysely();
    await db
      .updateTable('tasks')
      .set({ comment_url: commentUrl })
      .where('uuid', '=', taskUuid)
      .execute();
  }

  async updateTaskCommit(taskUuid: string, commit_sha: string): Promise<void> {
    const db = this.dbManager.getKysely();
    await db
      .updateTable('tasks')
      .set({ commit_sha })
      .where('uuid', '=', taskUuid)
      .execute();
  }

  async createTask(jobUuid: string, description: string, type: 'build' | 'address' | 'lint_and_test' = 'build'): Promise<string> {
    const task: Task = {
      uuid: randomUUID(),
      job_uuid: jobUuid,
      description,
      status: 'not_started',
      pr_link: null,
      execution_log: null,
      branch: null,
      type,
      comment_url: null,
      commit_sha: null
    };

    const db = this.dbManager.getKysely();
    await db.insertInto('tasks').values(task).execute();

    return task.uuid;
  }

  async getTask(taskUuid: string): Promise<Task | null> {
    const db = this.dbManager.getKysely();
    const task = await db
      .selectFrom('tasks')
      .selectAll()
      .where('uuid', '=', taskUuid)
      .executeTakeFirst();

    return task || null;
  }

  async createJob(description: string, workingDir: string): Promise<string> {
    const job: Job = {
      uuid: randomUUID(),
      description,
      created_at: new Date().toISOString(),
      directory: workingDir
    };

    const db = this.dbManager.getKysely();
    await db.insertInto('jobs').values(job).execute();

    return job.uuid;
  }

  async getLatestJobId(workingDir: string): Promise<string> {
    const db = this.dbManager.getKysely();
    const job = await db
      .selectFrom('jobs')
      .selectAll()
      .where('directory', '=', workingDir)
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst();

    if (!job) {
      throw new Error('No jobs found for this directory');
    }

    return job.uuid;
  }

  getCurrentJobUuid(): string | null {
    return this.currentJobUuid;
  }

  close(): void {
    this.dbManager.close();
  }
}

