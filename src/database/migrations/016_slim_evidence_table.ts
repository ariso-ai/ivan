import type { Migration } from '../types.js';

export const migration: Migration = {
  id: 16,
  name: 'slim_evidence_table',
  up: [
    `DROP TABLE evidence`,
    `DROP TABLE evidence_fts`,
    `CREATE TABLE evidence (
      id TEXT PRIMARY KEY,
      source_system TEXT NOT NULL,
      source_type TEXT NOT NULL,
      external_url TEXT,
      parent_url TEXT,
      author_type TEXT,
      author_name TEXT,
      occurred_at TEXT,
      base_weight REAL,
      final_weight REAL,
      boosts_json TEXT,
      penalties_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_evidence_type ON evidence(source_type, occurred_at)`,
    `CREATE INDEX IF NOT EXISTS idx_evidence_weight ON evidence(final_weight)`
  ]
};
