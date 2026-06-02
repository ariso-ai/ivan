import type { Migration } from '../types.js';

export const migration: Migration = {
  id: 16,
  name: 'create_session_analyses_table',
  up: [
    `CREATE TABLE IF NOT EXISTS session_analyses (
    session_id TEXT PRIMARY KEY,
    project_path TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    file_modified_at TEXT NOT NULL,
    ai_title TEXT,
    session_timestamp TEXT NOT NULL,
    pattern_count INTEGER NOT NULL DEFAULT 0,
    analysis_json TEXT NOT NULL,
    analyzed_at TEXT NOT NULL
)`
  ]
};
