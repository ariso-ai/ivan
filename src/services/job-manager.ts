import { randomUUID } from 'crypto';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { DatabaseManager, Job, Task } from '../database.js';

export class JobManager {
  private dbManager: DatabaseManager;

  constructor() {
    this.dbManager = new DatabaseManager();
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
        finalTasks = await this.promptForTaskBreakdown(inputTasks[0]);
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

  private async promptForTaskBreakdown(originalTask: string): Promise<string[]> {
    console.log('');
    console.log(chalk.yellow('Break down the task into smaller tasks. Enter each task on a new line.'));
    console.log(chalk.gray('Press Enter twice when finished.'));
    console.log('');

    const tasks: string[] = [];
    let taskNumber = 1;

    while (true) {
      const { task } = await inquirer.prompt([
        {
          type: 'input',
          name: 'task',
          message: `Task ${taskNumber}:`,
          default: taskNumber === 1 ? originalTask : ''
        }
      ]);

      if (!task || task.trim().length === 0) {
        if (tasks.length === 0) {
          console.log(chalk.red('Please enter at least one task'));
          continue;
        }
        break;
      }

      tasks.push(task.trim());
      taskNumber++;
    }

    return tasks;
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

