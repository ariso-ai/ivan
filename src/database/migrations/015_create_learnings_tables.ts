import type { Migration } from '../types.js';

export const migration: Migration = {
  id: 15,
  name: 'create_learnings_tables',
  up: [
    `CREATE TABLE IF NOT EXISTS evidence (
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
    `CREATE TABLE IF NOT EXISTS learnings (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    source_type TEXT,
    title TEXT,
    statement TEXT NOT NULL,
    rationale TEXT,
    applicability TEXT,
    confidence REAL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
)`,
    `CREATE TABLE IF NOT EXISTS learning_evidence (
    learning_id TEXT NOT NULL,
    evidence_id TEXT NOT NULL,
    relationship_type TEXT NOT NULL DEFAULT 'supports',
    contribution_weight REAL,
    extraction_reason TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (learning_id, evidence_id),
    FOREIGN KEY (learning_id) REFERENCES learnings(id) ON DELETE CASCADE,
    FOREIGN KEY (evidence_id) REFERENCES evidence(id) ON DELETE CASCADE
)`,
    `CREATE TABLE IF NOT EXISTS learning_tags (
    learning_id TEXT NOT NULL,
    tag TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'inferred',
    weight REAL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (learning_id, tag),
    FOREIGN KEY (learning_id) REFERENCES learnings(id) ON DELETE CASCADE
)`,
    `CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
)`,
    `CREATE INDEX IF NOT EXISTS idx_evidence_type
    ON evidence(source_type, occurred_at)`,
    `CREATE INDEX IF NOT EXISTS idx_evidence_weight
    ON evidence(final_weight)`,
    `CREATE INDEX IF NOT EXISTS idx_learnings_status
    ON learnings(status, updated_at)`,
    `CREATE INDEX IF NOT EXISTS idx_learning_evidence_evidence
    ON learning_evidence(evidence_id)`,
    `CREATE INDEX IF NOT EXISTS idx_learning_tags_tag
    ON learning_tags(tag)`,
    `CREATE VIRTUAL TABLE IF NOT EXISTS learning_vectors USING vec0(
    learning_id TEXT PRIMARY KEY,
    vector float[1536] distance_metric=cosine
)`,
    `CREATE VIRTUAL TABLE IF NOT EXISTS learnings_fts USING fts5(
    id UNINDEXED,
    kind UNINDEXED,
    title,
    statement,
    rationale,
    applicability,
    tokenize = 'porter unicode61'
)`
  ]
};
