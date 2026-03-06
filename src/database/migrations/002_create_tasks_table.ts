import { Migration } from '../types.js';

export const migration: Migration = {
  id: 2,
  name: 'create_tasks_table',
  up: `
    CREATE TABLE IF NOT EXISTS tasks (
      uuid TEXT PRIMARY KEY,
      job_uuid TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT CHECK(status IN ('active', 'not_started', 'completed')) DEFAULT 'not_started',
      pr_link TEXT,
      FOREIGN KEY (job_uuid) REFERENCES jobs (uuid) ON DELETE CASCADE
    )
  `,
  down: `DROP TABLE IF EXISTS tasks`
};