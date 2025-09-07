import { randomUUID } from 'crypto';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { DatabaseManager, Job, Task } from '../database.js';
import { ClaudeExecutor } from './claude-executor.js';

export class JobManager {
  private dbManager: DatabaseManager;
  private claudeExecutor: ClaudeExecutor;

  constructor() {
    this.dbManager = new DatabaseManager();
    this.claudeExecutor = new ClaudeExecutor();
  }

  async promptForTasks(workingDir: string): Promise<{ job: Job; tasks: Task[] }> {
    console.log(chalk.blue.bold('🎯 What would you like to work on today?'));
    console.log('');

    const { taskInput } = await inquirer.prompt([
      {
        type: 'input',
        name: 'taskInput',
        message: 'Enter a task or list of tasks (separate multiple tasks with commas):',
        validate: (input: string) => {
          if (!input || input.trim().length === 0) {
            return 'Please enter at least one task';
          }
          return true;
        }
      }
    ]);

    const inputTasks = taskInput.split(',').map((task: string) => task.trim()).filter(Boolean);

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
          } as any
        ]);

        finalTasks = selectedTasks;
        console.log(chalk.green(`✅ Selected ${selectedTasks.length} task(s)`));
      }
    }

    const job = await this.createJob(taskInput, finalTasks, workingDir);
    const tasks = await this.createTasks(job.uuid, finalTasks);

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
          } as any
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

  async createJob(description: string, tasks: string[], workingDir: string): Promise<Job> {
    const job: Job = {
      uuid: randomUUID(),
      description,
      created_at: new Date().toISOString(),
      directory: workingDir
    };

    const db = this.dbManager.getKysely();
    await db.insertInto('jobs').values(job).execute();

    return job;
  }

  private async createTasks(jobUuid: string, taskDescriptions: string[]): Promise<Task[]> {
    const tasks: Task[] = taskDescriptions.map(description => ({
      uuid: randomUUID(),
      job_uuid: jobUuid,
      description,
      status: 'not_started' as const,
      pr_link: null,
      execution_log: null
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

  close(): void {
    this.dbManager.close();
  }
}

