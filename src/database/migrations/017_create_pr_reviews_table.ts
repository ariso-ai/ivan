import type { Migration } from '../types.js';

export const migration: Migration = {
  id: 17,
  name: 'create_pr_reviews_table',
  up: [
    `CREATE TABLE IF NOT EXISTS pr_reviews (
    uuid TEXT PRIMARY KEY,
    job_uuid TEXT NOT NULL,
    pr_number INTEGER NOT NULL,
    pr_url TEXT,
    pr_title TEXT,
    status TEXT NOT NULL DEFAULT 'not_started',
    review_log TEXT,
    review_output TEXT,
    repository_id INTEGER,
    created_at TEXT NOT NULL,
    FOREIGN KEY (job_uuid) REFERENCES jobs(uuid)
)`,
    `CREATE INDEX IF NOT EXISTS idx_pr_reviews_job_uuid ON pr_reviews(job_uuid)`,
    `CREATE INDEX IF NOT EXISTS idx_pr_reviews_created_at ON pr_reviews(created_at)`
  ],
  down: [`DROP TABLE IF EXISTS pr_reviews`]
};
