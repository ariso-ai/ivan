import { Migration } from '../types.js';

export const migration: Migration = {
  id: 7,
  name: 'add_commit_sha_to_tasks',
  up: `
    ALTER TABLE tasks ADD COLUMN commit_sha TEXT
  `,
  down: `
    -- SQLite doesn't support DROP COLUMN directly
    -- Would need to recreate the table without this column
    SELECT 'DROP COLUMN not supported in SQLite';
  `
};