import { Migration } from '../types.js';

export const migration: Migration = {
  id: 1,
  name: 'create_jobs_table',
  up: `
    CREATE TABLE IF NOT EXISTS jobs (
      uuid TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      directory TEXT NOT NULL
    )
  `,
  down: `DROP TABLE IF EXISTS jobs`
};