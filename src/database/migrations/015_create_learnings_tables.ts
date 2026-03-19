import type { Migration } from '../types.js';

export const migration: Migration = {
  id: 15,
  name: 'create_learnings_tables',
  up: [
    `CREATE TABLE IF NOT EXISTS learnings (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    source_type TEXT,
    source_url TEXT,
    title TEXT,
    statement TEXT NOT NULL,
    rationale TEXT,
    applicability TEXT,
    confidence REAL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
)`,
    `CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
)`,
    `CREATE INDEX IF NOT EXISTS idx_learnings_status
    ON learnings(status, updated_at)`,
    `CREATE VIRTUAL TABLE IF NOT EXISTS learning_vectors USING vec0(
    learning_id TEXT PRIMARY KEY,
    vector float[1536] distance_metric=cosine
)`
  ]
};
