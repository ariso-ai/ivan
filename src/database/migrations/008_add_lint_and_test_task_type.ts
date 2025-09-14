import { Migration } from '../types.js';

export const migration008: Migration = {
  id: 8,
  name: 'add_lint_and_test_task_type',
  up: [
    `CREATE TABLE tasks_new (
      uuid TEXT PRIMARY KEY,
      job_uuid TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('active', 'not_started', 'completed')),
      pr_link TEXT,
      execution_log TEXT,
      branch TEXT,
      type TEXT NOT NULL CHECK(type IN ('build', 'address', 'lint_and_test')),
      comment_url TEXT,
      commit_sha TEXT,
      FOREIGN KEY (job_uuid) REFERENCES jobs(uuid)
    )`,
    `INSERT INTO tasks_new SELECT * FROM tasks`,
    `DROP TABLE tasks`,
    `ALTER TABLE tasks_new RENAME TO tasks`
  ],
  down: [
    `CREATE TABLE tasks_new (
      uuid TEXT PRIMARY KEY,
      job_uuid TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('active', 'not_started', 'completed')),
      pr_link TEXT,
      execution_log TEXT,
      branch TEXT,
      type TEXT NOT NULL CHECK(type IN ('build', 'address')),
      comment_url TEXT,
      commit_sha TEXT,
      FOREIGN KEY (job_uuid) REFERENCES jobs(uuid)
    )`,
    `INSERT INTO tasks_new SELECT * FROM tasks WHERE type != 'lint_and_test'`,
    `DROP TABLE tasks`,
    `ALTER TABLE tasks_new RENAME TO tasks`
  ]
};

