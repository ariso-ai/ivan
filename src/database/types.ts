export interface Job {
  uuid: string;
  description: string;
  created_at: string;
  directory: string;
}

export interface Task {
  uuid: string;
  job_uuid: string;
  description: string;
  status: 'active' | 'not_started' | 'completed';
  pr_link: string | null;
  execution_log: string | null;
  branch: string | null;
  type: 'build' | 'address' | 'lint_and_test';
  comment_url: string | null;
  commit_sha: string | null;
}

export interface Migration {
  id: number;
  name: string;
  up: string | string[];
  down: string | string[];
}

export interface Database {
  jobs: Job;
  tasks: Task;
  migrations: {
    id: number;
    name: string;
    executed_at: string;
  };
}
