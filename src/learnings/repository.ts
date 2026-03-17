// Repository identity resolution and learnings directory management.
// Responsible for identifying which repo is being tracked and creating the local
// `.ivan/` storage directory.

import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { createRepositoryId, slugify } from './id.js';
import { resolveCanonicalLearningsPath } from './paths.js';
import type { RepositoryRecord } from './record-types.js';

/** Resolved identity information for the repository being tracked; passed through the init/extract pipeline. */
export interface LearningsRepositoryContext {
  repoPath: string;
  repositoryId: string;
  repositorySlug: string;
  repositoryName: string;
  remoteUrl?: string;
}

/** Derives repository identity from `repoPath` and git metadata. */
export function resolveLearningsRepositoryContext(
  repoPath: string
): LearningsRepositoryContext {
  const resolvedRepoPath = path.resolve(repoPath);
  assertDirectoryExists(resolvedRepoPath);

  const repositoryName = path.basename(resolvedRepoPath);
  const repositorySlug = slugify(repositoryName);
  const repositoryId = createRepositoryId(repositorySlug);

  return withOptionalFields<LearningsRepositoryContext>(
    {
      repoPath: resolvedRepoPath,
      repositoryId,
      repositorySlug,
      repositoryName
    },
    {
      remoteUrl: readRemoteUrl(resolvedRepoPath)
    }
  );
}

/** Constructs the synthetic repository record used to populate the derived SQLite database. */
export function buildRepositoryRecord(
  context: LearningsRepositoryContext
): RepositoryRecord {
  const now = new Date().toISOString();

  return withOptionalFields<RepositoryRecord>(
    {
      type: 'repository',
      sourcePath: '.ivan#derived',
      id: context.repositoryId,
      slug: context.repositorySlug,
      name: context.repositoryName,
      local_path: context.repoPath,
      is_active: true,
      created_at: now,
      updated_at: now
    },
    {
      remote_url: context.remoteUrl
    }
  );
}

/** Creates `.ivan/` if it doesn't exist; returns the list of paths actually created. */
export function ensureLearningsDirectories(
  context: LearningsRepositoryContext
): string[] {
  const directory = resolveCanonicalLearningsPath(context.repoPath);
  if (fs.existsSync(directory)) {
    return [];
  }

  fs.mkdirSync(directory, { recursive: true });
  return [directory];
}

/** Creates empty canonical JSONL files when they do not already exist. */
export function ensureCanonicalJsonlFiles(repoPath: string): string[] {
  const files = [
    resolveCanonicalLearningsPath(repoPath, 'evidence.jsonl'),
    resolveCanonicalLearningsPath(repoPath, 'lessons.jsonl')
  ];
  const created: string[] = [];

  for (const filePath of files) {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, '', 'utf8');
      created.push(filePath);
    }
  }

  return created;
}

/**
 * No-op: `.ivan/db.sqlite` is intentionally tracked in git so the database is
 * available to all collaborators without requiring a rebuild.
 * Always returns false (no changes made).
 */
export function ensureGitignoreCoverage(_repoPath: string): boolean {
  return false;
}

/** Throws a descriptive error if `repoPath` does not exist or is not a directory. */
function assertDirectoryExists(repoPath: string): void {
  if (!fs.existsSync(repoPath)) {
    throw new Error(`Repository path does not exist: ${repoPath}`);
  }

  if (!fs.statSync(repoPath).isDirectory()) {
    throw new Error(`Repository path is not a directory: ${repoPath}`);
  }
}

/** Reads `remote.origin.url` from git config; returns `undefined` silently if the repo has no remote. */
function readRemoteUrl(repoPath: string): string | undefined {
  try {
    const remoteUrl = execFileSync(
      'git',
      ['config', '--get', 'remote.origin.url'],
      {
        cwd: repoPath,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      }
    ).trim();

    return remoteUrl || undefined;
  } catch {
    return undefined;
  }
}

function withOptionalFields<T extends object>(
  base: T,
  optionalFields: Record<string, unknown>
): T {
  const result = { ...base } as Record<string, unknown>;

  for (const [key, value] of Object.entries(optionalFields)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }

  return result as T;
}
