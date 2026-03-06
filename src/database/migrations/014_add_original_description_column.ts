import { Migration } from '../types.js';

export const migration: Migration = {
  id: 14,
  name: 'add_original_description_column',
  up: [
    'ALTER TABLE tasks ADD COLUMN original_description TEXT'
  ]
};
