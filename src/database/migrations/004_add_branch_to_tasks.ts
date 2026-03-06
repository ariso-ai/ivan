import { Migration } from '../types.js';

export const migration: Migration = {
  id: 4,
  name: 'add_branch_to_tasks',
  up: `
    ALTER TABLE tasks ADD COLUMN branch TEXT;
  `,
  down: `
    ALTER TABLE tasks DROP COLUMN branch;
  `
};