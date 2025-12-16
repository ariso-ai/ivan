import { Migration } from '../types.js';

export const migration: Migration = {
  id: 12,
  name: 'create_learning_embeddings_table',
  up: `
    CREATE VIRTUAL TABLE learning_embeddings USING vec0(
      embedding float[3072],
      +learning_id INTEGER,
      +text TEXT
    )
  `,
  down: `DROP TABLE learning_embeddings`
};
