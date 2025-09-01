import { Migration } from '../migration.js';

export const initialSchema: Migration = {
  id: '001_initial_schema',
  name: 'Create initial schema with jobs, tasks, agents, and executions',
  
  async up(db) {
    await db.schema
      .createTable('jobs')
      .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
      .addColumn('title', 'text', (col) => col.notNull())
      .addColumn('description', 'text')
      .addColumn('status', 'text', (col) => col.notNull().defaultTo('pending'))
      .addColumn('repository', 'text', (col) => col.notNull())
      .addColumn('created_at', 'text', (col) => col.notNull().defaultTo('CURRENT_TIMESTAMP'))
      .addColumn('updated_at', 'text', (col) => col.notNull().defaultTo('CURRENT_TIMESTAMP'))
      .addColumn('completed_at', 'text')
      .execute();

    await db.schema
      .createTable('tasks')
      .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
      .addColumn('job_id', 'integer', (col) => col.notNull().references('jobs.id').onDelete('cascade'))
      .addColumn('title', 'text', (col) => col.notNull())
      .addColumn('description', 'text')
      .addColumn('status', 'text', (col) => col.notNull().defaultTo('pending'))
      .addColumn('order_index', 'integer', (col) => col.notNull().defaultTo(0))
      .addColumn('created_at', 'text', (col) => col.notNull().defaultTo('CURRENT_TIMESTAMP'))
      .addColumn('updated_at', 'text', (col) => col.notNull().defaultTo('CURRENT_TIMESTAMP'))
      .addColumn('completed_at', 'text')
      .execute();

    await db.schema
      .createTable('agents')
      .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
      .addColumn('name', 'text', (col) => col.notNull())
      .addColumn('type', 'text', (col) => col.notNull())
      .addColumn('config', 'text')
      .addColumn('created_at', 'text', (col) => col.notNull().defaultTo('CURRENT_TIMESTAMP'))
      .execute();

    await db.schema
      .createTable('executions')
      .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
      .addColumn('task_id', 'integer', (col) => col.notNull().references('tasks.id').onDelete('cascade'))
      .addColumn('agent_id', 'integer', (col) => col.notNull().references('agents.id'))
      .addColumn('input', 'text', (col) => col.notNull())
      .addColumn('output', 'text')
      .addColumn('status', 'text', (col) => col.notNull().defaultTo('running'))
      .addColumn('started_at', 'text', (col) => col.notNull().defaultTo('CURRENT_TIMESTAMP'))
      .addColumn('completed_at', 'text')
      .addColumn('error_message', 'text')
      .execute();

    await db.schema
      .createIndex('idx_tasks_job_id')
      .on('tasks')
      .column('job_id')
      .execute();

    await db.schema
      .createIndex('idx_executions_task_id')
      .on('executions')
      .column('task_id')
      .execute();
  },

  async down(db) {
    await db.schema.dropTable('executions').execute();
    await db.schema.dropTable('tasks').execute();
    await db.schema.dropTable('agents').execute();
    await db.schema.dropTable('jobs').execute();
  }
};