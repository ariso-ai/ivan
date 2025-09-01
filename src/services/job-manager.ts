import { Kysely } from 'kysely';
import { Database, JobTable, TaskTable } from '../database/types.js';
import { TaskPlan } from './claude-planner.js';
import chalk from 'chalk';

export class JobManager {
  private db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.db = db;
  }

  async createJob(title: string, description: string, repository: string): Promise<number> {
    console.log(chalk.gray('📝 Creating job...'));
    
    const result = await this.db
      .insertInto('jobs')
      .values({
        title,
        description,
        status: 'pending',
        repository,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const jobId = result.id;
    if (!jobId) {
      throw new Error('Failed to create job');
    }
    
    console.log(chalk.green(`✓ Created job #${jobId}`));
    return jobId;
  }

  async createTasks(jobId: number, tasks: TaskPlan[]): Promise<void> {
    console.log(chalk.gray(`📋 Creating ${tasks.length} tasks for job #${jobId}...`));
    
    const taskValues = tasks.map(task => ({
      job_id: jobId,
      title: task.title,
      description: task.description,
      status: 'pending' as const,
      order_index: task.order,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }));

    await this.db
      .insertInto('tasks')
      .values(taskValues)
      .execute();

    console.log(chalk.green(`✓ Created ${tasks.length} tasks`));
  }

  async getJobTasks(jobId: number): Promise<TaskTable[]> {
    return await this.db
      .selectFrom('tasks')
      .where('job_id', '=', jobId)
      .orderBy('order_index', 'asc')
      .selectAll()
      .execute();
  }

  async updateJobStatus(jobId: number, status: JobTable['status']): Promise<void> {
    await this.db
      .updateTable('jobs')
      .set({
        status,
        updated_at: new Date().toISOString(),
        ...(status === 'completed' ? { completed_at: new Date().toISOString() } : {})
      })
      .where('id', '=', jobId)
      .execute();
  }

  async updateTaskStatus(taskId: number | undefined, status: TaskTable['status']): Promise<void> {
    if (!taskId) return;
    await this.db
      .updateTable('tasks')
      .set({
        status,
        updated_at: new Date().toISOString(),
        ...(status === 'completed' ? { completed_at: new Date().toISOString() } : {})
      })
      .where('id', '=', taskId)
      .execute();
  }

  async getJob(jobId: number): Promise<JobTable | undefined> {
    return await this.db
      .selectFrom('jobs')
      .where('id', '=', jobId)
      .selectAll()
      .executeTakeFirst();
  }
}