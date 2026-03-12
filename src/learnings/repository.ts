// Repository identity resolution and learnings directory management.
// Responsible for identifying which repo is being tracked, creating the directory
// structure, and keeping the `repositories.jsonl` registry up to date.

import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { createRepositoryId, slugify } from './id.js';
import type { RepositoryRecord } from './record-types.js';
import { loadCanonicalRecords } from './parser.js';

/** Resolved identity information for the repository being tracked; passed through the init/extract pipeline. */
export interface LearningsRepositoryContext {
  repoPath: string;
  repositoryId: string;
  repositorySlug: string;
  repositoryName: string;
  remoteUrl?: string;
  existingRecord?: RepositoryRecord;
}

/**
 * Reads any existing repository record for `repoPath` (or derives identity from the directory name),
 * reads the git remote URL, and returns a fully populated `LearningsRepositoryContext`.
 */
export function resolveLearningsRepositoryContext(
  repoPath: string
): LearningsRepositoryContext {
  const resolvedRepoPath = path.resolve(repoPath);
  assertDirectoryExists(resolvedRepoPath);

  const existingRecord = getExistingRepositoryRecord(resolvedRepoPath);
  const repositoryName =
    existingRecord?.name ?? path.basename(resolvedRepoPath);
  const repositorySlug =
    existingRecord?.slug ?? slugify(path.basename(resolvedRepoPath));
  const repositoryId = existingRecord?.id ?? createRepositoryId(repositorySlug);

  return withOptionalFields<LearningsRepositoryContext>({
    repoPath: resolvedRepoPath,
    repositoryId,
    repositorySlug,
    repositoryName,
  }, {
    remoteUrl: existingRecord?.remote_url ?? readRemoteUrl(resolvedRepoPath),
    existingRecord
  });
}

/** Constructs a `RepositoryRecord` from context; preserves `created_at` from any existing record. */
export function buildRepositoryRecord(
  context: LearningsRepositoryContext
): RepositoryRecord {
  const now = new Date().toISOString();

  return withOptionalFields<RepositoryRecord>({
    type: 'repository',
    sourcePath: 'learnings/repositories.jsonl',
    id: context.repositoryId,
    slug: context.repositorySlug,
    name: context.repositoryName,
    local_path: context.repoPath,
    is_active: true,
    created_at: context.existingRecord?.created_at ?? now,
    updated_at: now
  }, {
    remote_url: context.remoteUrl
  });
}

/** Returns the absolute path to `learnings/repositories.jsonl` for the context's repo. */
export function getRepositoryRecordPath(
  context: LearningsRepositoryContext
): string {
  return path.join(context.repoPath, 'learnings', 'repositories.jsonl');
}

/** Creates `learnings/`, `learnings/evidence/`, and `learnings/lessons/` if they don't exist; returns the list of paths actually created. */
export function ensureLearningsDirectories(
  context: LearningsRepositoryContext
): string[] {
  const directories = [
    path.join(context.repoPath, 'learnings'),
    path.join(context.repoPath, 'learnings', 'evidence'),
    path.join(context.repoPath, 'learnings', 'lessons')
  ];
  const created: string[] = [];

  for (const directory of directories) {
    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
      created.push(directory);
    }
  }

  return created;
}

/**
 * Appends `learnings.db` and `learnings.db-*` to `.gitignore` if they are not already present.
 * Returns true if the file was modified, false if no changes were needed.
 */
export function ensureGitignoreCoverage(repoPath: string): boolean {
  const gitignorePath = path.join(repoPath, '.gitignore');
  const requiredPatterns = ['learnings.db', 'learnings.db-*'];
  const existingContent = fs.existsSync(gitignorePath)
    ? fs.readFileSync(gitignorePath, 'utf8')
    : '';
  const normalized = existingContent.replace(/\r\n/g, '\n');
  const existingLines = new Set(normalized.split('\n'));
  const missingPatterns = requiredPatterns.filter(
    (pattern) => !existingLines.has(pattern)
  );

  if (missingPatterns.length === 0) {
    return false;
  }

  const nextContent =
    normalized.trimEnd().length > 0
      ? `${normalized.trimEnd()}\n\n# Derived learnings database\n${missingPatterns.join('\n')}\n`
      : `# Derived learnings database\n${missingPatterns.join('\n')}\n`;

  fs.writeFileSync(gitignorePath, nextContent);
  return true;
}

/**
 * Upserts the repository record for `context` into `repositories.jsonl` (sorted by id),
 * removes any legacy directory, and returns whether the record was newly created.
 */
export function writeRepositoryRecord(context: LearningsRepositoryContext): {
  filePath: string;
  created: boolean;
} {
  const record = buildRepositoryRecord(context);
  const filePath = getRepositoryRecordPath(context);
  const existingRecords = loadCanonicalRecords(context.repoPath).repositories;
  const created = !existingRecords.some(
    (existingRecord) => existingRecord.id === record.id
  );

  const mergedRecords = [...existingRecords.filter((existingRecord) => existingRecord.id !== record.id), record]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((repositoryRecord) => serializeRepositoryRecord(repositoryRecord));

  const nextContent = mergedRecords
    .map((repositoryRecord) => `${JSON.stringify(repositoryRecord)}\n`)
    .join('');
  fs.writeFileSync(filePath, nextContent, 'utf8');
  removeLegacyRepositoriesDirectory(context.repoPath);

  return { filePath, created };
}

/** Produces the plain-object form of a `RepositoryRecord` for JSON serialization, omitting `type` and `sourcePath`. */
function serializeRepositoryRecord(
  record: RepositoryRecord
): Omit<RepositoryRecord, 'type' | 'sourcePath'> {
  return withOptionalFields<Omit<RepositoryRecord, 'type' | 'sourcePath'>>({
    id: record.id,
    slug: record.slug,
    name: record.name,
    is_active: record.is_active,
    created_at: record.created_at,
    updated_at: record.updated_at
  }, {
    local_path: record.local_path,
    remote_url: record.remote_url
  });
}

/** Removes the old `learnings/repositories/` directory from a prior schema version, if present. */
function removeLegacyRepositoriesDirectory(repoPath: string): void {
  const legacyDirectory = path.join(repoPath, 'learnings', 'repositories');
  if (!fs.existsSync(legacyDirectory)) {
    return;
  }

  const entries = fs.readdirSync(legacyDirectory);
  if (entries.length === 0) {
    fs.rmdirSync(legacyDirectory);
    return;
  }

  for (const entry of entries) {
    fs.rmSync(path.join(legacyDirectory, entry), { force: true, recursive: true });
  }
  fs.rmdirSync(legacyDirectory);
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

/**
 * Reads the canonical records and returns the single matching repository for `repoPath`.
 * Throws if more than one record exists and none matches by `local_path`.
 */
function getExistingRepositoryRecord(
  repoPath: string
): RepositoryRecord | undefined {
  const dataset = loadCanonicalRecords(repoPath);

  if (dataset.repositories.length === 0) {
    return undefined;
  }

  if (dataset.repositories.length === 1) {
    return dataset.repositories[0];
  }

  const matchingRecord = dataset.repositories.filter(
    (record) =>
      record.local_path && path.resolve(record.local_path) === repoPath
  );

  if (matchingRecord.length === 1) {
    return matchingRecord[0];
  }

  throw new Error(
    `Expected a single repository record in ${repoPath}/learnings/repositories.jsonl but found ${dataset.repositories.length}`
  );
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
  const result: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(optionalFields)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }

  return result as T;
}
