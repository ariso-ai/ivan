import type { Generated } from 'kysely';

export interface Repository {
  id: Generated<number>;
  remote_url: string | null;
  directory: string;
  name: string;
  created_at: Generated<string>;
}

export interface Job {
  uuid: string;
  description: string;
  created_at: string;
  directory: string;
  repository_id: number;
}

export interface Task {
  uuid: string;
  job_uuid: string;
  description: string;
  status: 'active' | 'not_started' | 'completed';
  pr_link: string | null;
  execution_log: string | null;
  branch: string | null;
  type: 'build' | 'address' | 'lint_and_test' | 'merge_conflict';
  comment_url: string | null;
  comment_id: string | null;
  commit_sha: string | null;
  repository_id: number;
  original_description: string | null;
}

export interface Migration {
  id: number;
  name: string;
  up: string | string[];
  down?: string | string[]; // optional — we never roll back schema changes
}

export interface PrReview {
  uuid: string;
  job_uuid: string;
  pr_number: number;
  pr_url: string | null;
  pr_title: string | null;
  status: 'not_started' | 'active' | 'completed' | 'failed';
  review_log: string | null;
  review_output: string | null;
  repository_id: number | null;
  created_at: string;
}

export interface Database {
  repositories: Repository;
  jobs: Job;
  tasks: Task;
  pr_reviews: PrReview;
  migrations: {
    id: number;
    name: string;
    executed_at: string;
  };
}
