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
  type: 'build' | 'address';
}

export interface Migration {
  id: number;
  name: string;
  up: string;
  down: string;
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
