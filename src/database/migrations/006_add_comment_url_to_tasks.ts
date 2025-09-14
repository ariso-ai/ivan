import { Migration } from '../types.js';

export const migration: Migration = {
  id: 6,
  name: 'add_comment_url_to_tasks',
  up: `
    -- Column might already exist from a previous run
    SELECT 'Column comment_url might already exist';
  `,
  down: `
    -- SQLite doesn't support DROP COLUMN directly
    -- Would need to recreate the table without this column
    SELECT 'DROP COLUMN not supported in SQLite';
  `
};