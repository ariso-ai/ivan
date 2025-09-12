import { Migration } from '../types.js';

export const migration: Migration = {
  id: 5,
  name: 'add_type_to_tasks',
  up: `
    ALTER TABLE tasks ADD COLUMN type TEXT DEFAULT 'build';
  `,
  down: `
    ALTER TABLE tasks DROP COLUMN type;
  `
};