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
  headSha?: string;
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
  id?: string;
  isResolved: boolean;
  isOutdated?: boolean;
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
      url?: string;
      diffHunk?: string;
    }>;
  };
}

export interface GitHubPullRequestEvidenceResponse extends GitHubPRInfo {
  body?: string;
  issueComments: Array<{
    id: string;
    body: string;
    createdAt: string;
    author?: {
      login: string;
    };
    url?: string;
  }>;
  reviews: Array<{
    id: string;
    body: string;
    state: string;
    submittedAt?: string;
    author?: {
      login: string;
    };
    url?: string;
  }>;
  files: Array<{
    path: string;
    additions?: number;
    deletions?: number;
    changeType?: string;
  }>;
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

  private async makeRequest<T>(
    endpoint: string,
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE' = 'GET',
    body?: Record<string, unknown>
  ): Promise<T> {
    const url = endpoint.startsWith('http')
      ? endpoint
      : `${this.baseUrl}${endpoint}`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.pat}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };

    if (body) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, {
      method,
      headers,
      ...(body !== undefined && { body: JSON.stringify(body) })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `GitHub API request failed: ${response.status} ${response.statusText}\n${errorText}`
      );
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
  static getRepoInfoFromRemote(workingDir: string): {
    owner: string;
    repo: string;
  } {
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
    }>(`/repos/${owner}/${repo}/pulls`, 'POST', {
      title,
      body,
      head,
      base,
      draft
    });

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
  async addPRComment(
    owner: string,
    repo: string,
    prNumber: number,
    body: string
  ): Promise<void> {
    await this.makeRequest(
      `/repos/${owner}/${repo}/issues/${prNumber}/comments`,
      'POST',
      {
        body
      }
    );
  }

  /**
   * Get a specific pull request
   */
  async getPR(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<GitHubPRInfo> {
    const response = await this.makeRequest<{
      number: number;
      title: string;
      head: { ref: string; sha?: string };
      html_url: string;
      state: string;
      user?: { login: string };
    }>(`/repos/${owner}/${repo}/pulls/${prNumber}`);

    return {
      number: response.number,
      title: response.title,
      headRefName: response.head.ref,
      ...(response.head.sha !== undefined && { headSha: response.head.sha }),
      url: response.html_url,
      state: response.state,
      ...(response.user && { author: { login: response.user.login } })
    };
  }

  async getPullRequestEvidence(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<GitHubPullRequestEvidenceResponse> {
    const prResponse = await this.makeRequest<{
      number: number;
      title: string;
      body?: string;
      head: { ref: string; sha?: string };
      html_url: string;
      state: string;
      user?: { login: string };
    }>(`/repos/${owner}/${repo}/pulls/${prNumber}`);

    const [issueComments, reviewResponse, files] = await Promise.all([
      this.makeRequest<
        Array<{
          id: number;
          body: string;
          created_at: string;
          user?: { login: string };
          html_url?: string;
        }>
      >(`/repos/${owner}/${repo}/issues/${prNumber}/comments`),
      this.makeRequest<
        Array<{
          id: number;
          body?: string;
          state: string;
          submitted_at?: string;
          user?: { login: string };
          html_url?: string;
        }>
      >(`/repos/${owner}/${repo}/pulls/${prNumber}/reviews`),
      this.makeRequest<
        Array<{
          filename: string;
          additions?: number;
          deletions?: number;
          status?: string;
        }>
      >(`/repos/${owner}/${repo}/pulls/${prNumber}/files`)
    ]);

    return {
      number: prResponse.number,
      title: prResponse.title,
      ...(prResponse.body !== undefined && { body: prResponse.body }),
      headRefName: prResponse.head.ref,
      ...(prResponse.head.sha !== undefined && {
        headSha: prResponse.head.sha
      }),
      url: prResponse.html_url,
      state: prResponse.state,
      ...(prResponse.user && { author: { login: prResponse.user.login } }),
      issueComments: issueComments.map((comment) => ({
        id: String(comment.id),
        body: comment.body,
        createdAt: comment.created_at,
        ...(comment.user && { author: { login: comment.user.login } }),
        ...(comment.html_url !== undefined && { url: comment.html_url })
      })),
      reviews: reviewResponse.map((review) => ({
        id: String(review.id),
        body: review.body ?? '',
        state: review.state,
        ...(review.submitted_at !== undefined && {
          submittedAt: review.submitted_at
        }),
        ...(review.user && { author: { login: review.user.login } }),
        ...(review.html_url !== undefined && { url: review.html_url })
      })),
      files: files.map((file) => ({
        path: file.filename,
        ...(file.additions !== undefined && { additions: file.additions }),
        ...(file.deletions !== undefined && { deletions: file.deletions }),
        ...(file.status !== undefined && { changeType: file.status })
      }))
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
    const prs = await this.makeRequest<
      Array<{
        number: number;
        title: string;
        head: { ref: string };
        html_url: string;
        state: string;
        user?: { login: string };
      }>
    >(endpoint);

    // Map to GitHubPRInfo format
    const mappedPRs: GitHubPRInfo[] = prs.map((pr) => ({
      number: pr.number,
      title: pr.title,
      headRefName: pr.head.ref,
      url: pr.html_url,
      state: pr.state,
      ...(pr.user && { author: { login: pr.user.login } })
    }));

    // Filter by author if specified (REST API doesn't support this directly)
    if (options.author) {
      return mappedPRs.filter((pr) => pr.author?.login === options.author);
    }

    return mappedPRs;
  }

  /**
   * Paginated fetch of PR numbers, supporting a synthetic "merged" state (closed + merged_at filter).
   */
  async listPullRequestNumbers(
    owner: string,
    repo: string,
    state: 'open' | 'closed' | 'merged' | 'all',
    limit: number
  ): Promise<number[]> {
    const apiState = state === 'merged' ? 'closed' : state;
    const numbers: number[] = [];
    let page = 1;

    while (numbers.length < limit) {
      const perPage = Math.min(100, limit - numbers.length);
      const prs = await this.makeRequest<
        Array<{ number: number; merged_at: string | null }>
      >(
        `/repos/${owner}/${repo}/pulls?state=${apiState}&per_page=${perPage}&page=${page}&sort=created&direction=desc`
      );
      if (prs.length === 0) break;
      const filtered =
        state === 'merged' ? prs.filter((pr) => pr.merged_at !== null) : prs;
      numbers.push(...filtered.map((pr) => pr.number));
      if (prs.length < perPage) break;
      page++;
    }

    return numbers.slice(0, limit);
  }

  /**
   * Get PR checks/status
   */
  async getPRChecks(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<GitHubCheck[]> {
    const pr = await this.getPR(owner, repo, prNumber);
    const headSha = pr.headSha;

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
      state:
        check.conclusion?.toUpperCase() ||
        check.status?.toUpperCase() ||
        'PENDING',
      ...(check.html_url !== undefined && { link: check.html_url })
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
                id
                isResolved
                isOutdated
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
                    url
                    diffHunk
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

  async getDetailedReviewThreads(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<GitHubReviewThread[]> {
    return this.getReviewThreads(owner, repo, prNumber);
  }

  /**
   * Get workflow run logs (for failed actions)
   */
  async getWorkflowRunLogs(
    owner: string,
    repo: string,
    runId: number
  ): Promise<string> {
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

  /**
   * Add a reply to a review thread
   */
  async addReviewThreadReply(
    owner: string,
    repo: string,
    prNumber: number,
    commentId: string,
    body: string
  ): Promise<void> {
    // First, get all review threads to find the thread containing this comment
    const query = `
      query {
        repository(owner: "${owner}", name: "${repo}") {
          pullRequest(number: ${prNumber}) {
            reviewThreads(first: 100) {
              nodes {
                id
                comments(first: 100) {
                  nodes {
                    databaseId
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
            nodes: Array<{
              id: string;
              comments: {
                nodes: Array<{
                  databaseId?: number;
                }>;
              };
            }>;
          };
        };
      };
    }>(query);

    const threads = data.repository.pullRequest.reviewThreads.nodes;

    // Find the thread containing this comment
    let threadId: string | null = null;
    for (const thread of threads) {
      const comments = thread.comments?.nodes || [];
      if (comments.some((c) => c.databaseId?.toString() === commentId)) {
        threadId = thread.id;
        break;
      }
    }

    if (!threadId) {
      throw new Error('Could not find review thread for comment');
    }

    // Add reply using GraphQL mutation
    const mutation = `
      mutation {
        addPullRequestReviewThreadReply(input: {
          pullRequestReviewThreadId: "${threadId}"
          body: ${JSON.stringify(body)}
        }) {
          comment {
            id
          }
        }
      }
    `;

    await this.graphql(mutation);
  }
}
