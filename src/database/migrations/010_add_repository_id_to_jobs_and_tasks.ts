import { Migration } from '../types.js';

export const migration: Migration = {
  id: 10,
  name: 'add_repository_id_to_jobs_and_tasks',
  up: [
    `ALTER TABLE jobs ADD COLUMN repository_id INTEGER NOT NULL DEFAULT -1`,
    `ALTER TABLE tasks ADD COLUMN repository_id INTEGER NOT NULL DEFAULT -1`
  ],
  down: [
    `ALTER TABLE jobs DROP COLUMN repository_id`,
    `ALTER TABLE tasks DROP COLUMN repository_id`
  ]
};
