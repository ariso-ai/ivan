import { Migration } from '../types.js';

export const migration: Migration = {
  id: 14,
  name: 'add_prompt_rewriting_columns',
  up: [
    'ALTER TABLE tasks ADD COLUMN original_description TEXT',
    'ALTER TABLE tasks ADD COLUMN rewritten_description TEXT'
  ],
  down: [
    'ALTER TABLE tasks DROP COLUMN original_description',
    'ALTER TABLE tasks DROP COLUMN rewritten_description'
  ]
};
