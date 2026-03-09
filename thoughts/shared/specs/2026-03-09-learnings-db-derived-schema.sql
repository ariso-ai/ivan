-- Derived SQLite schema for learnings.db
--
-- Source of truth:
--   learnings/repositories/*.yaml
--   learnings/evidence/<repository_id>/*.md
--   learnings/lessons/<repository_id>/*.md
--
-- This DB is rebuildable. It is not the canonical storage layer.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS repositories (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    local_path TEXT,
    remote_url TEXT,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evidence (
    id TEXT PRIMARY KEY,
    repository_id TEXT NOT NULL,
    source_system TEXT NOT NULL,
    source_type TEXT NOT NULL,
    external_id TEXT,
    parent_external_id TEXT,
    url TEXT,
    pr_number INTEGER,
    review_id TEXT,
    thread_id TEXT,
    comment_id TEXT,
    author_type TEXT,
    author_name TEXT,
    author_role TEXT,
    title TEXT,
    content TEXT NOT NULL,
    file_path TEXT,
    line_start INTEGER,
    line_end INTEGER,
    review_state TEXT,
    resolution_state TEXT,
    occurred_at TEXT,
    base_weight REAL,
    final_weight REAL,
    boosts_json TEXT,
    penalties_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS learnings (
    id TEXT PRIMARY KEY,
    repository_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    source_type TEXT,
    title TEXT,
    statement TEXT NOT NULL,
    rationale TEXT,
    applicability TEXT,
    confidence REAL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS learning_evidence (
    learning_id TEXT NOT NULL,
    evidence_id TEXT NOT NULL,
    relationship_type TEXT NOT NULL DEFAULT 'supports',
    contribution_weight REAL,
    extraction_reason TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (learning_id, evidence_id),
    FOREIGN KEY (learning_id) REFERENCES learnings(id) ON DELETE CASCADE,
    FOREIGN KEY (evidence_id) REFERENCES evidence(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS learning_tags (
    learning_id TEXT NOT NULL,
    tag TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'inferred',
    weight REAL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (learning_id, tag),
    FOREIGN KEY (learning_id) REFERENCES learnings(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_evidence_repo_type
    ON evidence(repository_id, source_type, occurred_at);

CREATE INDEX IF NOT EXISTS idx_evidence_repo_weight
    ON evidence(repository_id, final_weight);

CREATE INDEX IF NOT EXISTS idx_learnings_repo_status
    ON learnings(repository_id, status, updated_at);

CREATE INDEX IF NOT EXISTS idx_learning_evidence_evidence
    ON learning_evidence(evidence_id);

CREATE INDEX IF NOT EXISTS idx_learning_tags_tag
    ON learning_tags(tag);

CREATE VIRTUAL TABLE IF NOT EXISTS evidence_fts USING fts5(
    id UNINDEXED,
    repository_id UNINDEXED,
    source_type UNINDEXED,
    title,
    content,
    tokenize = 'porter unicode61'
);

CREATE VIRTUAL TABLE IF NOT EXISTS learnings_fts USING fts5(
    id UNINDEXED,
    repository_id UNINDEXED,
    kind UNINDEXED,
    title,
    statement,
    rationale,
    applicability,
    tokenize = 'porter unicode61'
);

-- Requires sqlite-vec to be loaded by the builder/runtime.
-- Dimension is pinned for the launch model; change with a migration if the embedding model changes.
CREATE VIRTUAL TABLE IF NOT EXISTS learning_embeddings USING vec0(
    embedding float[3072],
    +learning_id TEXT,
    +model TEXT
);

-- Builder responsibilities:
-- 1. truncate/recreate all tables during rebuild
-- 2. populate base tables from canonical records
-- 3. populate evidence_fts and learnings_fts
-- 4. populate learning_embeddings from the chosen embedding provider
