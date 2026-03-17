// GitHub evidence fetching: type definitions for all PR data structures and two
// fetch strategies—REST/GraphQL via a PAT token, or the `gh` CLI for token-free use.

import { execSync } from 'child_process';
import { ConfigManager } from '../config.js';
import { GitHubAPIClient } from '../services/github-api-client.js';

/** A GitHub user, as returned by REST and GraphQL APIs. */
export interface GitHubActor {
  login: string;
}

/** A comment posted directly on the PR issue (not a review thread comment). */
export interface GitHubIssueCommentEvidence {
  id: string;
  body: string;
  createdAt: string;
  author?: GitHubActor;
  url?: string;
}

/** A full PR review submission (`APPROVED`, `CHANGES_REQUESTED`, or `COMMENTED`). */
export interface GitHubReviewEvidence {
  id: string;
  body: string;
  state: string;
  submittedAt?: string;
  author?: GitHubActor;
  url?: string;
}

/** A single comment within a review thread, which may be anchored to a specific file and line. */
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

/** A PR review thread containing one or more comments; may be resolved or outdated. */
export interface GitHubReviewThreadEvidence {
  id?: string;
  isResolved: boolean;
  isOutdated?: boolean;
  comments: GitHubReviewThreadCommentEvidence[];
}

/** Metadata about a single file changed in the PR. */
export interface GitHubFileEvidence {
  path: string;
  additions?: number;
  deletions?: number;
  changeType?: string;
}

/** A single CI check run result associated with the PR head commit. */
export interface GitHubCheckEvidence {
  name: string;
  state: string;
  link?: string;
}

/** Complete evidence payload for one PR: all comments, reviews, threads, files, and checks. */
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

/**
 * Entry point for PR evidence fetching: routes to the PAT-based REST/GraphQL path
 * or the `gh` CLI path depending on the configured auth type.
 */
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

/** Fetches all PR evidence via the GitHub REST API and GraphQL using a Personal Access Token. */
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
      ...(pr.headSha !== undefined && { headSha: pr.headSha }),
      ...(pr.author && { author: pr.author })
    },
    issueComments: pr.issueComments,
    reviews: pr.reviews,
    reviewThreads: reviewThreads.map((thread) => ({
      ...(thread.id !== undefined && { id: thread.id }),
      isResolved: thread.isResolved,
      ...(thread.isOutdated !== undefined && { isOutdated: thread.isOutdated }),
      comments: thread.comments.nodes.map((comment) => ({
        id: comment.id,
        ...(comment.databaseId !== undefined && {
          databaseId: comment.databaseId
        }),
        body: comment.body,
        createdAt: comment.createdAt,
        ...(comment.author && { author: { login: comment.author.login } }),
        ...(comment.path !== undefined && { path: comment.path }),
        ...(comment.line !== undefined && { line: comment.line }),
        ...(comment.url !== undefined && { url: comment.url })
      }))
    })),
    files: pr.files,
    checks: checks.map((check) => ({
      name: check.name,
      state: check.state,
      ...(check.link !== undefined && { link: check.link })
    }))
  };
}

/** Fetches all PR evidence by shelling out to the `gh` CLI, normalising the output into `GitHubPullRequestEvidence`. */
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
    query($owner: String!, $repo: String!, $prNumber: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $prNumber) {
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
    execSync(
      `gh api graphql -f query='${graphQlQuery}' -F owner='${repoInfo.owner.login}' -F repo='${repoInfo.name}' -F prNumber=${prNumber}`,
      {
        cwd: repoPath,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024 * 10
      }
    )
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
      ...(headSha !== undefined && { headSha }),
      ...(pr.author && { author: { login: pr.author.login } })
    },
    issueComments: (pr.comments ?? []).map((comment, index) => ({
      id: comment.id ?? `issue-comment-${pr.number}-${index + 1}`,
      body: comment.body ?? '',
      createdAt: comment.createdAt ?? '',
      ...(comment.author && { author: { login: comment.author.login } }),
      ...(comment.url !== undefined && { url: comment.url })
    })),
    reviews: (pr.reviews ?? []).map((review, index) => ({
      id: review.id ?? `review-${pr.number}-${index + 1}`,
      body: review.body ?? '',
      state: review.state ?? 'COMMENTED',
      ...(review.submittedAt !== undefined && {
        submittedAt: review.submittedAt
      }),
      ...(review.author && { author: { login: review.author.login } }),
      ...(review.url !== undefined && { url: review.url })
    })),
    reviewThreads: reviewThreads.map((thread) => ({
      ...(thread.id !== undefined && { id: thread.id }),
      isResolved: thread.isResolved ?? false,
      ...(thread.isOutdated !== undefined && { isOutdated: thread.isOutdated }),
      comments: (thread.comments?.nodes ?? []).map((comment) => ({
        id: comment.id ?? '',
        ...(comment.databaseId !== undefined && {
          databaseId: comment.databaseId
        }),
        body: comment.body ?? '',
        createdAt: comment.createdAt ?? '',
        ...(comment.author && { author: { login: comment.author.login } }),
        ...(comment.path !== undefined && { path: comment.path }),
        ...(comment.line !== undefined && { line: comment.line }),
        ...(comment.url !== undefined && { url: comment.url })
      }))
    })),
    files: (pr.files ?? []).map((file) => ({
      path: file.path,
      ...(file.additions !== undefined && { additions: file.additions }),
      ...(file.deletions !== undefined && { deletions: file.deletions }),
      ...(file.changeType !== undefined && { changeType: file.changeType })
    })),
    checks: checks.map((check) => ({
      name: check.name,
      state: check.state,
      ...(check.link !== undefined && { link: check.link })
    }))
  };
}
