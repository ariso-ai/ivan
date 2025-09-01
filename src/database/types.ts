export interface Database {
  migrations: MigrationTable;
  jobs: JobTable;
  tasks: TaskTable;
  agents: AgentTable;
  executions: ExecutionTable;
}

export interface MigrationTable {
  id: string;
  name: string;
  executed_at: string;
}

export interface JobTable {
  id?: number;
  title: string;
  description: string | null;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  repository: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface TaskTable {
  id?: number;
  job_id: number;
  title: string;
  description: string | null;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  order_index: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface AgentTable {
  id: number;
  name: string;
  type: 'claude' | 'openai';
  config: string | null;
  created_at: string;
}

export interface ExecutionTable {
  id: number;
  task_id: number;
  agent_id: number;
  input: string;
  output: string | null;
  status: 'running' | 'completed' | 'failed';
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
}
