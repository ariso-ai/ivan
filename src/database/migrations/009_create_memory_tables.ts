import { Migration } from '../types.js';

export const migration009: Migration = {
  id: 9,
  name: 'create_memory_tables',
  up: [
    `CREATE TABLE IF NOT EXISTS memory_items (
      id TEXT PRIMARY KEY,
      pr_number INTEGER NOT NULL,
      comment_author TEXT NOT NULL,
      comment_text TEXT NOT NULL,
      file_path TEXT,
      pr_description TEXT NOT NULL,
      resolution_summary TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      repository TEXT NOT NULL
    )`,

    `CREATE INDEX IF NOT EXISTS idx_memory_items_repo
      ON memory_items(repository)`,

    `CREATE INDEX IF NOT EXISTS idx_memory_items_created
      ON memory_items(created_at DESC)`,

    `CREATE VIRTUAL TABLE IF NOT EXISTS memory_embeddings USING vec0(
      id TEXT PRIMARY KEY,
      memory_item_id TEXT NOT NULL,
      chunk_text TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      embedding FLOAT[1536]
    )`
  ],
  down: [
    `DROP TABLE IF EXISTS memory_embeddings`,
    `DROP INDEX IF EXISTS idx_memory_items_created`,
    `DROP INDEX IF EXISTS idx_memory_items_repo`,
    `DROP TABLE IF EXISTS memory_items`
  ]
};
