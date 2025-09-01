import { IvanConfig } from './config/config.js';
import { DatabaseManager } from './database/database.js';
import { ClaudePlannerService } from './services/claude-planner.js';
import { JobManager } from './services/job-manager.js';
import { DockerOrchestrator } from './services/docker-orchestrator.js';
import chalk from 'chalk';

export class OrchestrationAgent {
  private config: IvanConfig;
  private dbManager: DatabaseManager;
  private claudePlanner: ClaudePlannerService;
  private jobManager: JobManager;

  constructor(config: IvanConfig, dbManager: DatabaseManager) {
    this.config = config;
    this.dbManager = dbManager;
    this.claudePlanner = new ClaudePlannerService(config.repository, config.anthropicApiKey);
    this.jobManager = new JobManager(dbManager.getDatabase());
  }

  public async executeTask(task: string): Promise<void> {
    console.log(chalk.gray('\n📝 Task:'), task);
    console.log(chalk.gray('─'.repeat(50)));

    try {
      // Step 1: Plan tasks with Claude
      const taskPlan = await this.claudePlanner.planTasks(task);

      // Step 2: Create job and tasks in database
      const jobId = await this.jobManager.createJob(
        task,
        `User request: ${task}`,
        this.config.repository
      );

      await this.jobManager.createTasks(jobId, taskPlan.tasks);

      // Step 3: Update job status to in_progress
      await this.jobManager.updateJobStatus(jobId, 'in_progress');

      // Step 4: Run tasks in Docker containers
      const orchestrator = new DockerOrchestrator(
        this.jobManager,
        this.config.repository,
        this.config.openAiApiKey
      );

      await orchestrator.runAllTasks(jobId);

      // Step 5: Update job status to completed
      const tasks = await this.jobManager.getJobTasks(jobId);
      const allCompleted = tasks.every(t => t.status === 'completed');

      if (allCompleted) {
        await this.jobManager.updateJobStatus(jobId, 'completed');
        console.log(chalk.green(`\n✅ Job #${jobId} completed successfully!`));
      } else {
        await this.jobManager.updateJobStatus(jobId, 'failed');
        console.log(chalk.yellow(`\n⚠️  Job #${jobId} completed with some failed tasks`));
      }

    } catch (error) {
      console.error(chalk.red('\n❌ Task execution failed:'), error);
      throw error;
    }
  }
}

