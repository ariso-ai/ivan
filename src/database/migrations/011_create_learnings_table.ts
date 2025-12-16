import { Migration } from '../types.js';

export const migration: Migration = {
  id: 11,
  name: 'create_learnings_table',
  up: `
    CREATE TABLE learnings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repository_id INTEGER NOT NULL,
      text TEXT NOT NULL,
      files TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE
    )
  `,
  down: `DROP TABLE learnings`
};
