import { Migration } from '../types.js';

export const migration: Migration = {
  id: 13,
  name: 'add_comment_id_to_tasks',
  up: `
    ALTER TABLE tasks ADD COLUMN comment_id TEXT;
  `,
  down: `
    ALTER TABLE tasks DROP COLUMN comment_id;
  `
};
