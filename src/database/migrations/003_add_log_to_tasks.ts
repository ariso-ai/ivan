import { Migration } from '../types.js';

export const migration: Migration = {
  id: 3,
  name: 'add_log_to_tasks',
  up: `
    ALTER TABLE tasks ADD COLUMN execution_log TEXT;
  `,
  down: `
    ALTER TABLE tasks DROP COLUMN execution_log;
  `
};