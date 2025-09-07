import { Migration } from '../types.js';
import { migration as createJobsTable } from './001_create_jobs_table.js';
import { migration as createTasksTable } from './002_create_tasks_table.js';
import { migration as addLogToTasks } from './003_add_log_to_tasks.js';

export const migrations: Migration[] = [
  createJobsTable,
  createTasksTable,
  addLogToTasks
];