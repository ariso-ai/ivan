// Repository identity resolution and learnings directory management.
// Responsible for identifying which repo is being tracked and creating the local
// `.ivan/` storage directory.

import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { resolveCanonicalLearningsPath } from './paths.js';

/** Resolved path context for the repository being tracked. */
export interface LearningsRepositoryContext {
  repoPath: string;
  remoteUrl?: string;
}

/** Resolves and validates the repository path. */
export function resolveLearningsRepositoryContext(
  repoPath: string
): LearningsRepositoryContext {
  const resolvedRepoPath = path.resolve(repoPath);
  assertDirectoryExists(resolvedRepoPath);

  const remoteUrl = readRemoteUrl(resolvedRepoPath);
  return {
    repoPath: resolvedRepoPath,
    ...(remoteUrl !== undefined ? { remoteUrl } : {})
  };
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

