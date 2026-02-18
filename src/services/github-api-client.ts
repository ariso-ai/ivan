import { execSync } from 'child_process';

export interface GitHubAPIConfig {
  pat: string;
  owner: string;
  repo: string;
}

export interface GitHubPRInfo {
  number: number;
  title: string;
  headRefName: string;
  url: string; // GitHub web URL (html_url from API)
  state: string;
  author?: {
    login: string;
  };
}

export interface GitHubCheck {
  name: string;
  state: string;
  link?: string;
  workflow?: string;
}

export interface GitHubReviewThread {
  isResolved: boolean;
  comments: {
    nodes: Array<{
      id: string;
      databaseId?: number;
      body: string;
      author: {
        login: string;
      };
      createdAt: string;
      path?: string;
      line?: number;
    }>;
  };
}

export interface GitHubRepo {
  owner: {
    login: string;
  };
  name: string;
  defaultBranchRef: {
    name: string;
  };
}

/**
 * GitHub API client for making REST and GraphQL requests using a Personal Access Token
 */
export class GitHubAPIClient {
  private pat: string;
  private baseUrl = 'https://api.github.com';

  constructor(pat: string) {
    this.pat = pat;
  }

  /**
   * Make a REST API request to GitHub
   */
  private async makeRequest<T>(
    endpoint: string,
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE' = 'GET',
    body?: Record<string, unknown>
  ): Promise<T> {
    const url = endpoint.startsWith('http') ? endpoint : `${this.baseUrl}${endpoint}`;

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.pat}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };

    if (body) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GitHub API request failed: ${response.status} ${response.statusText}\n${errorText}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Make a GraphQL query to GitHub
   */
  async graphql<T>(query: string): Promise<T> {
    const response = await this.makeRequest<{ data: T }>('/graphql', 'POST', {
      query
    });

    return response.data;
  }

  /**
   * Get repository information from remote URL
   */
  static getRepoInfoFromRemote(workingDir: string): { owner: string; repo: string } {
    try {
      const remoteUrl = execSync('git config --get remote.origin.url', {
        cwd: workingDir,
        encoding: 'utf8'
      }).trim();

      // Parse various GitHub URL formats:
      // - https://github.com/owner/repo.git
      // - git@github.com:owner/repo.git
      // - https://github.com/owner/repo
      // - git@github.com:owner/repo

      let owner: string;
      let repo: string;

      if (remoteUrl.startsWith('https://')) {
        // HTTPS format: https://github.com/owner/repo.git
        const match = remoteUrl.match(/github\.com\/([^/]+)\/([^/.]+)/);
        if (!match) {
          throw new Error(`Could not parse GitHub URL: ${remoteUrl}`);
        }
        owner = match[1];
        repo = match[2];
      } else if (remoteUrl.startsWith('git@')) {
        // SSH format: git@github.com:owner/repo.git
        const match = remoteUrl.match(/github\.com:([^/]+)\/([^/.]+)/);
        if (!match) {
          throw new Error(`Could not parse GitHub URL: ${remoteUrl}`);
        }
        owner = match[1];
        repo = match[2];
      } else {
        throw new Error(`Unsupported GitHub URL format: ${remoteUrl}`);
      }

      return { owner, repo };
    } catch (error) {
      throw new Error(`Failed to get repository info from remote: ${error}`);
    }
  }

  /**
   * Get repository details including default branch
   */
  async getRepository(owner: string, repo: string): Promise<GitHubRepo> {
    const query = `
      query {
        repository(owner: "${owner}", name: "${repo}") {
          owner {
            login
          }
          name
          defaultBranchRef {
            name
          }
        }
      }
    `;

    const data = await this.graphql<{ repository: GitHubRepo }>(query);
    return data.repository;
  }

  /**
   * Create a pull request
   */
  async createPullRequest(
    owner: string,
    repo: string,
    title: string,
    body: string,
    head: string,
    base: string,
    draft = true
  ): Promise<GitHubPRInfo> {
    const response = await this.makeRequest<{
      number: number;
      title: string;
      head: { ref: string };
      html_url: string;
      state: string;
    }>(
      `/repos/${owner}/${repo}/pulls`,
      'POST',
      {
        title,
        body,
        head,
        base,
        draft
      }
    );

    return {
      number: response.number,
      title: response.title,
      headRefName: response.head.ref,
      url: response.html_url,
      state: response.state
    };
  }

  /**
   * Add a comment to a pull request
   */
  async addPRComment(owner: string, repo: string, prNumber: number, body: string): Promise<void> {
    await this.makeRequest(`/repos/${owner}/${repo}/issues/${prNumber}/comments`, 'POST', {
      body
    });
  }

  /**
   * Get a specific pull request
   */
  async getPR(owner: string, repo: string, prNumber: number): Promise<GitHubPRInfo> {
    const response = await this.makeRequest<{
      number: number;
      title: string;
      head: { ref: string };
      html_url: string;
      state: string;
      user?: { login: string };
    }>(`/repos/${owner}/${repo}/pulls/${prNumber}`);

    return {
      number: response.number,
      title: response.title,
      headRefName: response.head.ref,
      url: response.html_url,
      state: response.state,
      author: response.user ? { login: response.user.login } : undefined
    };
  }

  /**
   * List pull requests
   */
  async listPRs(
    owner: string,
    repo: string,
    options: {
      state?: 'open' | 'closed' | 'all';
      head?: string;
      base?: string;
      author?: string;
    } = {}
  ): Promise<GitHubPRInfo[]> {
    const params = new URLSearchParams();
    if (options.state) params.append('state', options.state);
    if (options.head) params.append('head', options.head);
    if (options.base) params.append('base', options.base);

    let endpoint = `/repos/${owner}/${repo}/pulls?${params.toString()}`;
    const prs = await this.makeRequest<Array<{
      number: number;
      title: string;
      head: { ref: string };
      html_url: string;
      state: string;
      user?: { login: string };
    }>>(endpoint);

    // Map to GitHubPRInfo format
    const mappedPRs = prs.map(pr => ({
      number: pr.number,
      title: pr.title,
      headRefName: pr.head.ref,
      url: pr.html_url,
      state: pr.state,
      author: pr.user ? { login: pr.user.login } : undefined
    }));

    // Filter by author if specified (REST API doesn't support this directly)
    if (options.author) {
      return mappedPRs.filter((pr) => pr.author?.login === options.author);
    }

    return mappedPRs;
  }

  /**
   * Get PR checks/status
   */
  async getPRChecks(owner: string, repo: string, prNumber: number): Promise<GitHubCheck[]> {
    const pr = await this.getPR(owner, repo, prNumber);
    const headSha = (pr as unknown as { head?: { sha?: string } }).head?.sha;

    if (!headSha) {
      return [];
    }

    interface CheckRun {
      name: string;
      conclusion?: string;
      status?: string;
      html_url?: string;
    }

    // Get check runs
    const checkRuns = await this.makeRequest<{ check_runs: CheckRun[] }>(
      `/repos/${owner}/${repo}/commits/${headSha}/check-runs`
    );

    return checkRuns.check_runs.map((check) => ({
      name: check.name,
      state: check.conclusion?.toUpperCase() || check.status?.toUpperCase() || 'PENDING',
      link: check.html_url
    }));
  }

  /**
   * Get review threads for a PR using GraphQL
   */
  async getReviewThreads(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<GitHubReviewThread[]> {
    const query = `
      query {
        repository(owner: "${owner}", name: "${repo}") {
          pullRequest(number: ${prNumber}) {
            reviewThreads(first: 100) {
              nodes {
                isResolved
                comments(first: 100) {
                  nodes {
                    id
                    databaseId
                    body
                    author {
                      login
                    }
                    createdAt
                    path
                    line
                  }
                }
              }
            }
          }
        }
      }
    `;

    const data = await this.graphql<{
      repository: {
        pullRequest: {
          reviewThreads: {
            nodes: GitHubReviewThread[];
          };
        };
      };
    }>(query);

    return data.repository.pullRequest.reviewThreads.nodes;
  }

  /**
   * Get workflow run logs (for failed actions)
   */
  async getWorkflowRunLogs(owner: string, repo: string, runId: number): Promise<string> {
    try {
      interface Job {
        id: number;
        conclusion?: string;
        name: string;
      }

      // Get jobs for this run
      const jobs = await this.makeRequest<{ jobs: Job[] }>(
        `/repos/${owner}/${repo}/actions/runs/${runId}/jobs`
      );

      let logs = '';
      for (const job of jobs.jobs) {
        if (job.conclusion === 'failure') {
          // Get logs for this job
          try {
            const jobLogs = await this.makeRequest<string>(
              `/repos/${owner}/${repo}/actions/jobs/${job.id}/logs`,
              'GET'
            );
            logs += `\n\n=== Failed logs for ${job.name} ===\n${jobLogs}`;
          } catch {
            // Continue if we can't get logs for a specific job
          }
        }
      }
      return logs;
    } catch {
      return '';
    }
  }

  /**
   * Update a pull request (e.g., to assign reviewers)
   */
  async updatePR(
    owner: string,
    repo: string,
    prNumber: number,
    updates: {
      assignees?: string[];
      reviewers?: string[];
      labels?: string[];
    }
  ): Promise<void> {
    if (updates.assignees) {
      await this.makeRequest(
        `/repos/${owner}/${repo}/issues/${prNumber}/assignees`,
        'POST',
        {
          assignees: updates.assignees
        }
      );
    }

    if (updates.reviewers) {
      await this.makeRequest(
        `/repos/${owner}/${repo}/pulls/${prNumber}/requested_reviewers`,
        'POST',
        {
          reviewers: updates.reviewers
        }
      );
    }

    if (updates.labels) {
      await this.makeRequest(
        `/repos/${owner}/${repo}/issues/${prNumber}/labels`,
        'POST',
        {
          labels: updates.labels
        }
      );
    }
  }
}
