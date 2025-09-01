import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as os from 'os';
import chalk from 'chalk';
import { TaskTable } from '../database/types.js';
import { JobManager } from './job-manager.js';

const execAsync = promisify(exec);

export class DockerOrchestrator {
  private jobManager: JobManager;
  private repository: string;
  private openAiApiKey: string;

  constructor(jobManager: JobManager, repository: string, openAiApiKey: string) {
    this.jobManager = jobManager;
    this.repository = repository;
    this.openAiApiKey = openAiApiKey;
  }

  async runTask(task: TaskTable): Promise<void> {
    console.log(chalk.blue(`\n🐳 Running task: ${task.title}`));
    
    if (!task.id) {
      throw new Error('Task ID is required');
    }
    
    await this.jobManager.updateTaskStatus(task.id, 'in_progress');

    try {
      const containerName = `ivan-task-${task.id}`;
      const branchName = `ivan/${task.title}`;
      const homeDir = os.homedir();
      const scriptPath = path.join(process.cwd(), 'dist', 'scripts', 'task-executor.js');

      // Build Docker command
      const dockerCommand = `docker run --rm \
        --name ${containerName} \
        -v ${homeDir}/.claude:${homeDir}/.claude:ro \
        -v ${homeDir}/.ssh:${homeDir}/.ssh:ro \
        -v ${scriptPath}:/app/task-executor.js:ro \
        -e TASK_ID="${task.id}" \
        -e TASK_TITLE="${task.title}" \
        -e TASK_DESCRIPTION="${task.description}" \
        -e BRANCH_NAME="${branchName}" \
        -e REPOSITORY="${this.repository}" \
        -e OPENAI_API_KEY="${this.openAiApiKey}" \
        -e IVAN_DB_PATH="${homeDir}/.ivan/db.sqlite" \
        -v ${homeDir}/.ivan/db.sqlite:${homeDir}/.ivan/db.sqlite \
        -w /workspace \
        node:20-alpine \
        node /app/task-executor.js`;

      console.log(chalk.gray('Starting Docker container...'));
      
      const { stdout, stderr } = await execAsync(dockerCommand);
      
      if (stdout) console.log(chalk.gray(stdout));
      if (stderr) console.error(chalk.yellow(stderr));

      await this.jobManager.updateTaskStatus(task.id, 'completed');
      console.log(chalk.green(`✓ Task ${task.title} completed`));
      
    } catch (error) {
      console.error(chalk.red(`✗ Task ${task.title} failed:`), error);
      await this.jobManager.updateTaskStatus(task.id, 'failed');
      throw error;
    }
  }

  async runAllTasks(jobId: number): Promise<void> {
    const tasks = await this.jobManager.getJobTasks(jobId);
    
    console.log(chalk.cyan(`\n🚀 Running ${tasks.length} tasks for job #${jobId}\n`));

    for (const task of tasks) {
      try {
        await this.runTask(task);
        console.log(chalk.gray('─'.repeat(50)));
      } catch (error) {
        console.error(chalk.red(`Failed to run task ${task.title}, continuing with next task...`));
      }
    }
  }
}