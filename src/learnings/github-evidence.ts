import { execSync } from 'child_process';
import { ConfigManager } from '../config.js';
import { GitHubAPIClient } from '../services/github-api-client.js';

export interface GitHubActor {
  login: string;
}

export interface GitHubIssueCommentEvidence {
  id: string;
  body: string;
  createdAt: string;
  author?: GitHubActor;
  url?: string;
}

export interface GitHubReviewEvidence {
  id: string;
  body: string;
  state: string;
  submittedAt?: string;
  author?: GitHubActor;
  url?: string;
}

export interface GitHubReviewThreadCommentEvidence {
  id: string;
  databaseId?: number;
  body: string;
  createdAt: string;
  author?: GitHubActor;
  path?: string;
  line?: number;
  url?: string;
}

export interface GitHubReviewThreadEvidence {
  id?: string;
  isResolved: boolean;
  isOutdated?: boolean;
  comments: GitHubReviewThreadCommentEvidence[];
}

export interface GitHubFileEvidence {
  path: string;
  additions?: number;
  deletions?: number;
  changeType?: string;
}

export interface GitHubCheckEvidence {
  name: string;
  state: string;
  link?: string;
}

export interface GitHubPullRequestEvidence {
  repository: {
    owner: string;
    name: string;
  };
  pullRequest: {
    number: number;
    title: string;
    body: string;
    url: string;
    state: string;
    headRefName: string;
    headSha?: string;
    author?: GitHubActor;
  };
  issueComments: GitHubIssueCommentEvidence[];
  reviews: GitHubReviewEvidence[];
  reviewThreads: GitHubReviewThreadEvidence[];
  files: GitHubFileEvidence[];
  checks: GitHubCheckEvidence[];
}

export async function fetchGitHubPullRequestEvidence(
  repoPath: string,
  prNumber: number
): Promise<GitHubPullRequestEvidence> {
  const configManager = new ConfigManager();
  const authType = configManager.getGithubAuthType();

  if (authType === 'pat') {
    const pat = configManager.getGithubPat();
    if (!pat) {
      throw new Error(
        'GitHub PAT is not configured. Please run "ivan configure" and set your PAT.'
      );
    }

    return fetchPatEvidence(repoPath, prNumber, pat);
  }

  return fetchCliEvidence(repoPath, prNumber);
}

async function fetchPatEvidence(
  repoPath: string,
  prNumber: number,
  pat: string
): Promise<GitHubPullRequestEvidence> {
  const repo = GitHubAPIClient.getRepoInfoFromRemote(repoPath);
  const client = new GitHubAPIClient(pat);
  const owner = repo.owner;
  const name = repo.repo;

  const pr = await client.getPullRequestEvidence(owner, name, prNumber);
  const reviewThreads = await client.getDetailedReviewThreads(
    owner,
    name,
    prNumber
  );
  const checks = await client.getPRChecks(owner, name, prNumber);

  return {
    repository: { owner, name },
    pullRequest: {
      number: pr.number,
      title: pr.title,
      body: pr.body ?? '',
      url: pr.url,
      state: pr.state,
      headRefName: pr.headRefName,
      headSha: pr.headSha,
      author: pr.author
    },
    issueComments: pr.issueComments,
    reviews: pr.reviews,
    reviewThreads,
    files: pr.files,
    checks: checks.map((check) => ({
      name: check.name,
      state: check.state,
      link: check.link
    }))
  };
}

async function fetchCliEvidence(
  repoPath: string,
  prNumber: number
): Promise<GitHubPullRequestEvidence> {
  const repoInfo = JSON.parse(
    execSync('gh repo view --json owner,name', {
      cwd: repoPath,
      encoding: 'utf8'
    })
  ) as {
    owner: { login: string };
    name: string;
  };

  const pr = JSON.parse(
    execSync(
      [
        'gh pr view',
        String(prNumber),
        '--json',
        'number,title,body,headRefName,url,state,author,reviews,comments,files'
      ].join(' '),
      {
        cwd: repoPath,
        encoding: 'utf8'
      }
    )
  ) as {
    number: number;
    title: string;
    body?: string;
    headRefName: string;
    url: string;
    state: string;
    author?: { login: string };
    comments?: Array<{
      id?: string;
      body?: string;
      createdAt?: string;
      author?: { login: string };
      url?: string;
    }>;
    reviews?: Array<{
      id?: string;
      body?: string;
      state?: string;
      submittedAt?: string;
      author?: { login: string };
      url?: string;
    }>;
    files?: Array<{
      path: string;
      additions?: number;
      deletions?: number;
      changeType?: string;
    }>;
  };

  const graphQlQuery = `
    query {
      repository(owner: "${repoInfo.owner.login}", name: "${repoInfo.name}") {
        pullRequest(number: ${prNumber}) {
          commits(last: 1) {
            nodes {
              commit {
                oid
              }
            }
          }
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
                  createdAt
                  path
                  line
                  url
                  author {
                    login
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  const threadResponse = JSON.parse(
    execSync(`gh api graphql -f query='${graphQlQuery}'`, {
      cwd: repoPath,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 10
    })
  ) as {
    data?: {
      repository?: {
        pullRequest?: {
          commits?: {
            nodes?: Array<{ commit?: { oid?: string } }>;
          };
          reviewThreads?: {
            nodes?: Array<{
              id?: string;
              isResolved?: boolean;
              isOutdated?: boolean;
              comments?: {
                nodes?: Array<{
                  id?: string;
                  databaseId?: number;
                  body?: string;
                  createdAt?: string;
                  path?: string;
                  line?: number;
                  url?: string;
                  author?: { login: string };
                }>;
              };
            }>;
          };
        };
      };
    };
  };

  const checks = JSON.parse(
    execSync(`gh pr checks ${prNumber} --json name,state,link`, {
      cwd: repoPath,
      encoding: 'utf8'
    })
  ) as Array<{
    name: string;
    state: string;
    link?: string;
  }>;

  const reviewThreads =
    threadResponse.data?.repository?.pullRequest?.reviewThreads?.nodes ?? [];
  const headSha =
    threadResponse.data?.repository?.pullRequest?.commits?.nodes?.[0]?.commit
      ?.oid;

  return {
    repository: {
      owner: repoInfo.owner.login,
      name: repoInfo.name
    },
    pullRequest: {
      number: pr.number,
      title: pr.title,
      body: pr.body ?? '',
      url: pr.url,
      state: pr.state,
      headRefName: pr.headRefName,
      headSha,
      author: pr.author ? { login: pr.author.login } : undefined
    },
    issueComments: (pr.comments ?? []).map((comment, index) => ({
      id: comment.id ?? `issue-comment-${pr.number}-${index + 1}`,
      body: comment.body ?? '',
      createdAt: comment.createdAt ?? '',
      author: comment.author ? { login: comment.author.login } : undefined,
      url: comment.url
    })),
    reviews: (pr.reviews ?? []).map((review, index) => ({
      id: review.id ?? `review-${pr.number}-${index + 1}`,
      body: review.body ?? '',
      state: review.state ?? 'COMMENTED',
      submittedAt: review.submittedAt,
      author: review.author ? { login: review.author.login } : undefined,
      url: review.url
    })),
    reviewThreads: reviewThreads.map((thread) => ({
      id: thread.id,
      isResolved: thread.isResolved ?? false,
      isOutdated: thread.isOutdated ?? false,
      comments: (thread.comments?.nodes ?? []).map((comment) => ({
        id: comment.id ?? '',
        databaseId: comment.databaseId,
        body: comment.body ?? '',
        createdAt: comment.createdAt ?? '',
        author: comment.author ? { login: comment.author.login } : undefined,
        path: comment.path,
        line: comment.line,
        url: comment.url
      }))
    })),
    files: (pr.files ?? []).map((file) => ({
      path: file.path,
      additions: file.additions,
      deletions: file.deletions,
      changeType: file.changeType
    })),
    checks: checks.map((check) => ({
      name: check.name,
      state: check.state,
      link: check.link
    }))
  };
}
