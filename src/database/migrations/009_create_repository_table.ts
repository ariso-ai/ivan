import { Migration } from '../types.js';

export const migration: Migration = {
  id: 9,
  name: 'create_repository_table',
  up: `
    CREATE TABLE IF NOT EXISTS repositories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      remote_url TEXT,
      directory TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `,
  down: `DROP TABLE IF EXISTS repositories`
};
