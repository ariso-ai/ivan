import express from 'express';
import { Server } from 'http';
import { DatabaseManager } from './database.js';
import { Job, Task } from './database/types.js';

export class WebServer {
  private app: express.Application;
  private server: Server | null = null;
  private dbManager: DatabaseManager;
  private port: number;

  constructor(port: number = 3000) {
    this.app = express();
    this.dbManager = new DatabaseManager();
    this.port = port;
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    this.app.use(express.json());
    this.app.use(express.static('public'));
  }

  private setupRoutes(): void {
    // API Routes
    this.app.get('/api/jobs', this.getJobs.bind(this));
    this.app.get('/api/jobs/:jobId/tasks', this.getJobTasks.bind(this));
    
    // Serve the main HTML page for all non-API routes
    this.app.get('/', (req, res) => {
      res.send(this.getMainHTML());
    });
  }

  private async getJobs(req: express.Request, res: express.Response): Promise<void> {
    try {
      const db = this.dbManager.getKysely();
      const jobs = await db.selectFrom('jobs')
        .selectAll()
        .orderBy('created_at', 'desc')
        .execute();
      
      res.json(jobs);
    } catch (error) {
      console.error('Error fetching jobs:', error);
      res.status(500).json({ error: 'Failed to fetch jobs' });
    }
  }

  private async getJobTasks(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { jobId } = req.params;
      const db = this.dbManager.getKysely();
      
      const job = await db.selectFrom('jobs')
        .selectAll()
        .where('uuid', '=', jobId)
        .executeTakeFirst();
        
      if (!job) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }

      const tasks = await db.selectFrom('tasks')
        .selectAll()
        .where('job_uuid', '=', jobId)
        .execute();
      
      res.json({ job, tasks });
    } catch (error) {
      console.error('Error fetching job tasks:', error);
      res.status(500).json({ error: 'Failed to fetch job tasks' });
    }
  }

  private getMainHTML(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Ivan - Job Dashboard</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            color: #333;
            background: #f5f7fa;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
        }

        .header {
            background: white;
            padding: 20px 30px;
            border-radius: 12px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.05);
            margin-bottom: 30px;
        }

        .header h1 {
            color: #2c3e50;
            font-size: 2rem;
            margin-bottom: 10px;
        }

        .header p {
            color: #7f8c8d;
            font-size: 1.1rem;
        }

        .main-content {
            display: flex;
            gap: 30px;
        }

        .jobs-list {
            flex: 1;
            background: white;
            border-radius: 12px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.05);
            overflow: hidden;
        }

        .job-detail {
            flex: 2;
            background: white;
            border-radius: 12px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.05);
            overflow: hidden;
            display: none;
        }

        .section-header {
            background: #3498db;
            color: white;
            padding: 20px 30px;
            font-size: 1.2rem;
            font-weight: 600;
        }

        .job-item {
            padding: 20px 30px;
            border-bottom: 1px solid #ecf0f1;
            cursor: pointer;
            transition: background 0.2s ease;
        }

        .job-item:hover {
            background: #f8f9fa;
        }

        .job-item.active {
            background: #e3f2fd;
            border-left: 4px solid #3498db;
        }

        .job-item:last-child {
            border-bottom: none;
        }

        .job-title {
            font-weight: 600;
            color: #2c3e50;
            margin-bottom: 5px;
        }

        .job-meta {
            font-size: 0.9rem;
            color: #7f8c8d;
        }

        .job-detail-content {
            display: flex;
            height: 100%;
        }

        .tasks-sidebar {
            width: 350px;
            border-right: 1px solid #ecf0f1;
            overflow-y: auto;
        }

        .task-content {
            flex: 1;
            overflow-y: auto;
            padding: 30px;
        }

        .task-item {
            padding: 15px 20px;
            border-bottom: 1px solid #ecf0f1;
            cursor: pointer;
            transition: background 0.2s ease;
        }

        .task-item:hover {
            background: #f8f9fa;
        }

        .task-item.active {
            background: #e8f5e8;
            border-left: 4px solid #27ae60;
        }

        .task-title {
            font-weight: 500;
            color: #2c3e50;
            margin-bottom: 5px;
        }

        .task-status {
            font-size: 0.8rem;
            padding: 2px 8px;
            border-radius: 12px;
            font-weight: 500;
        }

        .status-not_started {
            background: #ffeaa7;
            color: #d68910;
        }

        .status-active {
            background: #74b9ff;
            color: #0984e3;
        }

        .status-completed {
            background: #00b894;
            color: white;
        }

        .task-detail-header {
            border-bottom: 1px solid #ecf0f1;
            padding-bottom: 20px;
            margin-bottom: 20px;
        }

        .task-detail-title {
            font-size: 1.3rem;
            color: #2c3e50;
            margin-bottom: 10px;
        }

        .pr-link {
            display: inline-block;
            background: #3498db;
            color: white;
            padding: 8px 16px;
            border-radius: 6px;
            text-decoration: none;
            font-size: 0.9rem;
            margin-top: 10px;
        }

        .pr-link:hover {
            background: #2980b9;
        }

        .execution-log {
            background: #2c3e50;
            color: #ecf0f1;
            padding: 20px;
            border-radius: 8px;
            font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
            font-size: 0.9rem;
            line-height: 1.4;
            white-space: pre-wrap;
            overflow-x: auto;
            max-height: 500px;
            overflow-y: auto;
        }

        .empty-state {
            padding: 60px 30px;
            text-align: center;
            color: #7f8c8d;
        }

        .empty-state h3 {
            margin-bottom: 10px;
            color: #95a5a6;
        }

        .loading {
            padding: 60px 30px;
            text-align: center;
            color: #7f8c8d;
        }

        @media (max-width: 768px) {
            .main-content {
                flex-direction: column;
                height: auto;
            }
            
            .job-detail-content {
                flex-direction: column;
            }
            
            .tasks-sidebar {
                width: 100%;
                max-height: 300px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="main-content">
            <div class="jobs-list">
                <div class="section-header">
                    Jobs
                </div>
                <div id="jobs-container">
                    <div class="loading">Loading jobs...</div>
                </div>
            </div>

            <div class="job-detail" id="job-detail">
                <div class="section-header">
                    <span id="job-detail-title">Job Details</span>
                </div>
                <div class="job-detail-content">
                    <div class="tasks-sidebar">
                        <div id="tasks-container">
                            <div class="empty-state">
                                <h3>Select a job to view tasks</h3>
                            </div>
                        </div>
                    </div>
                    <div class="task-content">
                        <div id="task-detail-container">
                            <div class="empty-state">
                                <h3>Select a task to view details</h3>
                                <p>Choose a task from the sidebar to see its execution log and details.</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script>
        let jobs = [];
        let currentJob = null;
        let currentTasks = [];

        // Load jobs on page load
        loadJobs();

        async function loadJobs() {
            try {
                const response = await fetch('/api/jobs');
                jobs = await response.json();
                renderJobs();
            } catch (error) {
                console.error('Failed to load jobs:', error);
                document.getElementById('jobs-container').innerHTML = 
                    '<div class="empty-state"><h3>Failed to load jobs</h3><p>Please refresh the page</p></div>';
            }
        }

        function renderJobs() {
            const container = document.getElementById('jobs-container');
            
            if (jobs.length === 0) {
                container.innerHTML = '<div class="empty-state"><h3>No jobs found</h3><p>Create some tasks with Ivan CLI to see them here.</p></div>';
                return;
            }

            container.innerHTML = jobs.map(job => {
                const date = new Date(job.created_at).toLocaleString();
                return \`
                    <div class="job-item" onclick="selectJob('\${job.uuid}')">
                        <div class="job-title">\${job.description}</div>
                        <div class="job-meta">
                            <div>Created: \${date}</div>
                            <div>Directory: \${job.directory}</div>
                        </div>
                    </div>
                \`;
            }).join('');
        }

        async function selectJob(jobId) {
            // Update job item selection
            document.querySelectorAll('.job-item').forEach(item => item.classList.remove('active'));
            event.target.closest('.job-item').classList.add('active');

            try {
                const response = await fetch(\`/api/jobs/\${jobId}/tasks\`);
                const data = await response.json();
                
                currentJob = data.job;
                currentTasks = data.tasks;
                
                document.getElementById('job-detail-title').textContent = \`\${data.job.description}\`;
                document.getElementById('job-detail').style.display = 'block';
                
                renderTasks();
                
                // Clear task detail
                document.getElementById('task-detail-container').innerHTML = 
                    '<div class="empty-state"><h3>Select a task to view details</h3><p>Choose a task from the sidebar to see its execution log and details.</p></div>';
                
                // Scroll to top of page
                window.scrollTo({ top: 0, behavior: 'smooth' });
                    
            } catch (error) {
                console.error('Failed to load job tasks:', error);
            }
        }

        function renderTasks() {
            const container = document.getElementById('tasks-container');
            
            if (currentTasks.length === 0) {
                container.innerHTML = '<div class="empty-state"><h3>No tasks found</h3></div>';
                return;
            }

            container.innerHTML = currentTasks.map(task => \`
                <div class="task-item" onclick="selectTask('\${task.uuid}')">
                    <div class="task-title">\${task.description}</div>
                    <div class="task-status status-\${task.status}">\${task.status.replace('_', ' ')}</div>
                </div>
            \`).join('');
        }

        function selectTask(taskId) {
            // Update task item selection
            document.querySelectorAll('.task-item').forEach(item => item.classList.remove('active'));
            event.target.closest('.task-item').classList.add('active');

            const task = currentTasks.find(t => t.uuid === taskId);
            if (!task) return;

            const container = document.getElementById('task-detail-container');
            
            container.innerHTML = \`
                <div class="task-detail-header">
                    <div class="task-detail-title">\${task.description}</div>
                    <div class="task-status status-\${task.status}">\${task.status.replace('_', ' ')}</div>
                    \${task.pr_link ? \`<a href="\${task.pr_link}" target="_blank" class="pr-link">View Pull Request</a>\` : ''}
                </div>
                \${task.execution_log ? \`
                    <h3 style="margin-bottom: 15px; color: #2c3e50;">Execution Log</h3>
                    <div class="execution-log">\${task.execution_log}</div>
                \` : '<div class="empty-state"><h3>No execution log</h3><p>This task hasn\\'t been executed yet or no log was recorded.</p></div>'}
            \`;
        }
    </script>
</body>
</html>`;
  }

  public start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, () => {
        console.log(`🌐 Ivan web server running at http://localhost:${this.port}`);
        resolve();
      });
    });
  }

  public stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }

      this.server.close((err) => {
        if (err) {
          reject(err);
        } else {
          this.server = null;
          resolve();
        }
      });
    });
  }

  public async close(): Promise<void> {
    await this.stop();
    this.dbManager.close();
  }
}