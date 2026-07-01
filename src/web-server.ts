import express from 'express';
import { Server } from 'http';
import { DatabaseManager } from './database.js';

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
    this.app.get('/api/jobs/:jobId/reviews', this.getJobReviews.bind(this));

    // Serve the main HTML page for all non-API routes
    this.app.get('/', (req, res) => {
      res.send(this.getMainHTML());
    });
  }

  private async getJobs(
    req: express.Request,
    res: express.Response
  ): Promise<void> {
    try {
      const db = this.dbManager.getKysely();
      const jobs = await db
        .selectFrom('jobs')
        .selectAll()
        .orderBy('created_at', 'desc')
        .execute();

      res.json(jobs);
    } catch (error) {
      console.error('Error fetching jobs:', error);
      res.status(500).json({ error: 'Failed to fetch jobs' });
    }
  }

  private async getJobTasks(
    req: express.Request,
    res: express.Response
  ): Promise<void> {
    try {
      const { jobId } = req.params;
      const db = this.dbManager.getKysely();

      const job = await db
        .selectFrom('jobs')
        .selectAll()
        .where('uuid', '=', jobId)
        .executeTakeFirst();

      if (!job) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }

      const tasks = await db
        .selectFrom('tasks')
        .selectAll()
        .where('job_uuid', '=', jobId)
        .execute();

      res.json({ job, tasks });
    } catch (error) {
      console.error('Error fetching job tasks:', error);
      res.status(500).json({ error: 'Failed to fetch job tasks' });
    }
  }

  private async getJobReviews(
    req: express.Request,
    res: express.Response
  ): Promise<void> {
    try {
      const { jobId } = req.params;
      const db = this.dbManager.getKysely();

      const job = await db
        .selectFrom('jobs')
        .selectAll()
        .where('uuid', '=', jobId)
        .executeTakeFirst();

      if (!job) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }

      const reviews = await db
        .selectFrom('pr_reviews')
        .selectAll()
        .where('job_uuid', '=', jobId)
        .execute();

      res.json({ job, reviews });
    } catch (error) {
      console.error('Error fetching job reviews:', error);
      res.status(500).json({ error: 'Failed to fetch job reviews' });
    }
  }

  private getMainHTML(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Ivan - Job Dashboard</title>
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        html, body {
            height: 100%;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            color: #333;
            background: #f5f7fa;
            display: flex;
            flex-direction: column;
        }

        .main-content {
            display: flex;
            flex: 1;
            min-height: 0;
            gap: 0;
        }

        .jobs-list {
            width: 300px;
            flex-shrink: 0;
            background: white;
            border-right: 1px solid #e1e4e8;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        .jobs-scroll {
            flex: 1;
            overflow-y: auto;
        }

        .job-detail {
            flex: 1;
            min-width: 0;
            background: white;
            display: none;
            flex-direction: column;
            overflow: hidden;
        }

        .job-detail.visible {
            display: flex;
        }

        .section-header {
            background: #24292f;
            color: white;
            padding: 14px 20px;
            font-size: 0.95rem;
            font-weight: 600;
            flex-shrink: 0;
        }

        .job-item {
            padding: 14px 20px;
            border-bottom: 1px solid #f0f0f0;
            cursor: pointer;
            transition: background 0.15s ease;
        }

        .job-item:hover { background: #f6f8fa; }

        .job-item.active {
            background: #dbeafe;
            border-left: 3px solid #3b82f6;
        }

        .job-item:last-child { border-bottom: none; }

        .job-title {
            font-weight: 600;
            font-size: 0.875rem;
            color: #24292f;
            margin-bottom: 3px;
        }

        .job-badge {
            display: inline-block;
            font-size: 0.65rem;
            padding: 1px 5px;
            border-radius: 6px;
            margin-left: 5px;
            vertical-align: middle;
            background: #7c3aed;
            color: white;
            font-weight: 600;
            letter-spacing: 0.02em;
        }

        .job-meta {
            font-size: 0.75rem;
            color: #6e7781;
        }

        .job-detail-content {
            display: flex;
            flex: 1;
            min-height: 0;
        }

        .tasks-sidebar {
            width: 300px;
            flex-shrink: 0;
            border-right: 1px solid #e1e4e8;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        .sidebar-tabs {
            display: flex;
            border-bottom: 1px solid #e1e4e8;
            flex-shrink: 0;
        }

        .sidebar-tab {
            flex: 1;
            padding: 10px;
            text-align: center;
            cursor: pointer;
            font-size: 0.8rem;
            font-weight: 500;
            color: #6e7781;
            border-bottom: 2px solid transparent;
            margin-bottom: -1px;
            transition: color 0.15s;
        }

        .sidebar-tab:hover { color: #24292f; }

        .sidebar-tab.active {
            color: #0969da;
            border-bottom-color: #0969da;
        }

        .sidebar-scroll {
            flex: 1;
            overflow-y: auto;
        }

        .task-content {
            flex: 1;
            min-width: 0;
            overflow-y: auto;
            padding: 30px 40px;
        }

        .task-item, .review-item {
            padding: 12px 16px;
            border-bottom: 1px solid #f0f0f0;
            cursor: pointer;
            transition: background 0.15s ease;
        }

        .task-item:hover, .review-item:hover { background: #f6f8fa; }

        .task-item.active {
            background: #dcfce7;
            border-left: 3px solid #16a34a;
        }

        .review-item.active {
            background: #ede9fe;
            border-left: 3px solid #7c3aed;
        }

        .task-title, .review-title {
            font-weight: 500;
            font-size: 0.85rem;
            color: #24292f;
            margin-bottom: 4px;
        }

        .task-status {
            display: inline-block;
            font-size: 0.7rem;
            padding: 1px 7px;
            border-radius: 10px;
            font-weight: 600;
        }

        .status-not_started { background: #fef9c3; color: #854d0e; }
        .status-active { background: #dbeafe; color: #1d4ed8; }
        .status-completed { background: #dcfce7; color: #15803d; }
        .status-failed { background: #fee2e2; color: #b91c1c; }

        .detail-header {
            padding-bottom: 20px;
            margin-bottom: 24px;
            border-bottom: 1px solid #e1e4e8;
        }

        .detail-title {
            font-size: 1.25rem;
            font-weight: 600;
            color: #24292f;
            margin-bottom: 8px;
        }

        .pr-link {
            display: inline-block;
            background: #0969da;
            color: white;
            padding: 6px 14px;
            border-radius: 6px;
            text-decoration: none;
            font-size: 0.85rem;
            margin-top: 8px;
            font-weight: 500;
        }

        .pr-link:hover { background: #0860ca; }

        .execution-log {
            background: #161b22;
            color: #c9d1d9;
            padding: 20px;
            border-radius: 8px;
            font-family: 'SF Mono', 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
            font-size: 0.825rem;
            line-height: 1.5;
            white-space: pre-wrap;
            overflow-x: auto;
        }

        /* Markdown-rendered review output */
        .review-markdown {
            font-size: 0.95rem;
            line-height: 1.7;
            color: #24292f;
        }

        .review-markdown h1,
        .review-markdown h2,
        .review-markdown h3,
        .review-markdown h4 {
            margin-top: 1.5em;
            margin-bottom: 0.5em;
            font-weight: 600;
            color: #24292f;
        }

        .review-markdown h1 { font-size: 1.4rem; border-bottom: 1px solid #e1e4e8; padding-bottom: 0.3em; }
        .review-markdown h2 { font-size: 1.15rem; border-bottom: 1px solid #e1e4e8; padding-bottom: 0.2em; }
        .review-markdown h3 { font-size: 1rem; }
        .review-markdown h4 { font-size: 0.9rem; }

        .review-markdown p { margin-bottom: 1em; }

        .review-markdown ul, .review-markdown ol {
            margin: 0.5em 0 1em 1.5em;
        }

        .review-markdown li { margin-bottom: 0.25em; }

        .review-markdown code {
            background: #f6f8fa;
            border: 1px solid #e1e4e8;
            border-radius: 4px;
            padding: 0.1em 0.4em;
            font-family: 'SF Mono', 'Monaco', 'Menlo', monospace;
            font-size: 0.85em;
        }

        .review-markdown pre {
            background: #161b22;
            border-radius: 8px;
            padding: 16px;
            overflow-x: auto;
            margin: 1em 0;
        }

        .review-markdown pre code {
            background: none;
            border: none;
            padding: 0;
            color: #c9d1d9;
            font-size: 0.85rem;
            line-height: 1.5;
        }

        .review-markdown blockquote {
            border-left: 4px solid #d0d7de;
            padding-left: 1em;
            color: #6e7781;
            margin: 1em 0;
        }

        .review-markdown hr {
            border: none;
            border-top: 1px solid #e1e4e8;
            margin: 1.5em 0;
        }

        .review-markdown strong { font-weight: 600; }

        .review-markdown a { color: #0969da; text-decoration: none; }
        .review-markdown a:hover { text-decoration: underline; }

        .empty-state {
            padding: 60px 30px;
            text-align: center;
            color: #6e7781;
        }

        .empty-state h3 {
            margin-bottom: 8px;
            color: #8c959f;
            font-weight: 500;
        }

        .loading {
            padding: 40px 20px;
            text-align: center;
            color: #6e7781;
            font-size: 0.875rem;
        }

        .section-label {
            font-size: 0.75rem;
            font-weight: 600;
            color: #6e7781;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-bottom: 12px;
        }

        @media (max-width: 900px) {
            .main-content { flex-direction: column; }
            .jobs-list { width: 100%; border-right: none; border-bottom: 1px solid #e1e4e8; max-height: 250px; }
            .tasks-sidebar { width: 100%; border-right: none; border-bottom: 1px solid #e1e4e8; max-height: 220px; }
            .job-detail-content { flex-direction: column; }
        }
    </style>
</head>
<body>
    <div class="main-content">
        <div class="jobs-list">
            <div class="section-header">Jobs</div>
            <div class="jobs-scroll" id="jobs-container">
                <div class="loading">Loading jobs...</div>
            </div>
        </div>

        <div class="job-detail" id="job-detail">
            <div class="section-header">
                <span id="job-detail-title">Job Details</span>
            </div>
            <div class="job-detail-content">
                <div class="tasks-sidebar">
                    <div class="sidebar-tabs">
                        <div class="sidebar-tab active" id="tab-tasks" onclick="switchTab('tasks')">Tasks</div>
                        <div class="sidebar-tab" id="tab-reviews" onclick="switchTab('reviews')">Reviews</div>
                    </div>
                    <div class="sidebar-scroll">
                        <div id="tasks-container">
                            <div class="empty-state"><h3>Select a job</h3></div>
                        </div>
                        <div id="reviews-container" style="display:none;">
                            <div class="empty-state"><h3>Select a job</h3></div>
                        </div>
                    </div>
                </div>
                <div class="task-content">
                    <div id="detail-container">
                        <div class="empty-state">
                            <h3>Select an item to view details</h3>
                            <p>Choose a task or review from the sidebar.</p>
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
        let currentReviews = [];
        let activeTab = 'tasks';

        marked.setOptions({ breaks: true, gfm: true });

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

        function esc(str) {
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
        }

        function renderJobs() {
            const container = document.getElementById('jobs-container');
            if (jobs.length === 0) {
                container.innerHTML = '<div class="empty-state"><h3>No jobs yet</h3><p>Run some Ivan commands to see jobs here.</p></div>';
                return;
            }
            container.innerHTML = jobs.map(job => {
                const date = new Date(job.created_at).toLocaleString();
                const isReview = job.description.startsWith('PR Review -');
                const badge = isReview ? '<span class="job-badge">review</span>' : '';
                return \`<div class="job-item" onclick="selectJob('\${esc(job.uuid)}', event)">
                    <div class="job-title">\${esc(job.description)}\${badge}</div>
                    <div class="job-meta">\${date}</div>
                </div>\`;
            }).join('');
        }

        async function selectJob(jobId, evt) {
            document.querySelectorAll('.job-item').forEach(el => el.classList.remove('active'));
            evt.target.closest('.job-item').classList.add('active');

            try {
                const [tasksResp, reviewsResp] = await Promise.all([
                    fetch(\`/api/jobs/\${jobId}/tasks\`),
                    fetch(\`/api/jobs/\${jobId}/reviews\`)
                ]);
                const tasksData = await tasksResp.json();
                const reviewsData = await reviewsResp.json();

                currentJob = tasksData.job;
                currentTasks = tasksData.tasks;
                currentReviews = reviewsData.reviews || [];

                document.getElementById('job-detail-title').textContent = currentJob.description;
                document.getElementById('job-detail').classList.add('visible');

                if (currentReviews.length > 0 && currentTasks.length === 0) {
                    switchTab('reviews');
                } else {
                    switchTab('tasks');
                }

                document.getElementById('detail-container').innerHTML =
                    '<div class="empty-state"><h3>Select an item to view details</h3><p>Choose a task or review from the sidebar.</p></div>';
            } catch (error) {
                console.error('Failed to load job data:', error);
            }
        }

        function switchTab(tab) {
            activeTab = tab;
            document.getElementById('tab-tasks').classList.toggle('active', tab === 'tasks');
            document.getElementById('tab-reviews').classList.toggle('active', tab === 'reviews');
            document.getElementById('tasks-container').style.display = tab === 'tasks' ? '' : 'none';
            document.getElementById('reviews-container').style.display = tab === 'reviews' ? '' : 'none';
            if (tab === 'tasks') renderTasks();
            else renderReviews();
        }

        function renderTasks() {
            const container = document.getElementById('tasks-container');
            if (currentTasks.length === 0) {
                container.innerHTML = '<div class="empty-state"><h3>No tasks</h3></div>';
                return;
            }
            container.innerHTML = currentTasks.map(task => \`
                <div class="task-item" onclick="selectTask('\${esc(task.uuid)}')">
                    <div class="task-title">\${esc(task.description)}</div>
                    <span class="task-status status-\${task.status}">\${task.status.replace('_', ' ')}</span>
                </div>
            \`).join('');
        }

        function renderReviews() {
            const container = document.getElementById('reviews-container');
            if (currentReviews.length === 0) {
                container.innerHTML = '<div class="empty-state"><h3>No reviews</h3></div>';
                return;
            }
            container.innerHTML = currentReviews.map(review => \`
                <div class="review-item" onclick="selectReview('\${esc(review.uuid)}')">
                    <div class="review-title">PR #\${review.pr_number}\${review.pr_title ? ': ' + esc(review.pr_title) : ''}</div>
                    <span class="task-status status-\${review.status}">\${review.status.replace('_', ' ')}</span>
                </div>
            \`).join('');
        }

        function selectTask(taskId) {
            document.querySelectorAll('.task-item').forEach(el => el.classList.remove('active'));
            event.target.closest('.task-item').classList.add('active');

            const task = currentTasks.find(t => t.uuid === taskId);
            if (!task) return;

            document.getElementById('detail-container').innerHTML = \`
                <div class="detail-header">
                    <div class="detail-title">\${esc(task.description)}</div>
                    <span class="task-status status-\${task.status}">\${task.status.replace('_', ' ')}</span>
                    \${task.pr_link ? \`<br><a href="\${esc(task.pr_link)}" target="_blank" class="pr-link">View Pull Request</a>\` : ''}
                </div>
                \${task.execution_log
                    ? \`<div class="section-label">Execution Log</div><div class="execution-log">\${esc(task.execution_log)}</div>\`
                    : '<div class="empty-state"><h3>No execution log</h3><p>This task has not run yet.</p></div>'}
            \`;
        }

        function selectReview(reviewId) {
            document.querySelectorAll('.review-item').forEach(el => el.classList.remove('active'));
            event.target.closest('.review-item').classList.add('active');

            const review = currentReviews.find(r => r.uuid === reviewId);
            if (!review) return;

            let bodyHtml;
            if (review.review_output) {
                bodyHtml = \`<div class="section-label">Review</div><div class="review-markdown">\${marked.parse(review.review_output)}</div>\`;
            } else if (review.review_log) {
                bodyHtml = \`<div class="section-label">Log</div><div class="execution-log">\${esc(review.review_log)}</div>\`;
            } else {
                bodyHtml = '<div class="empty-state"><h3>No review output yet</h3><p>The review is still running or has not started.</p></div>';
            }

            document.getElementById('detail-container').innerHTML = \`
                <div class="detail-header">
                    <div class="detail-title">PR #\${review.pr_number}\${review.pr_title ? ': ' + esc(review.pr_title) : ''}</div>
                    <span class="task-status status-\${review.status}">\${review.status.replace('_', ' ')}</span>
                    \${review.pr_url ? \`<br><a href="\${esc(review.pr_url)}" target="_blank" class="pr-link">View PR on GitHub</a>\` : ''}
                </div>
                \${bodyHtml}
            \`;
        }
    </script>
</body>
</html>`;
  }

  public start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, () => {
        console.log(
          `🌐 Ivan web server running at http://localhost:${this.port}`
        );
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
