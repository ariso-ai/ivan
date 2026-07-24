import { Migration } from '../types.js';

export const migration: Migration = {
  id: 18,
  name: 'add_merge_conflict_task_type',
  up: [
    `CREATE TABLE tasks_new (
      uuid TEXT PRIMARY KEY,
      job_uuid TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('active', 'not_started', 'completed')),
      pr_link TEXT,
      execution_log TEXT,
      branch TEXT,
      type TEXT NOT NULL CHECK(type IN ('build', 'address', 'lint_and_test', 'merge_conflict')),
      comment_url TEXT,
      commit_sha TEXT,
      repository_id INTEGER NOT NULL DEFAULT -1,
      comment_id TEXT,
      original_description TEXT,
      FOREIGN KEY (job_uuid) REFERENCES jobs(uuid)
    )`,
    `INSERT INTO tasks_new (uuid, job_uuid, description, status, pr_link, execution_log, branch, type, comment_url, commit_sha, repository_id, comment_id, original_description)
    SELECT uuid, job_uuid, description, status, pr_link, execution_log, branch, type, comment_url, commit_sha, repository_id, comment_id, original_description FROM tasks`,
    `DROP TABLE tasks`,
    `ALTER TABLE tasks_new RENAME TO tasks`
  ]
  // No down migration — we never roll back schema changes
};
