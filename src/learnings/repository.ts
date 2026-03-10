import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { stringifySimpleYaml } from './frontmatter.js';
import { createRepositoryId, slugify } from './id.js';
import { RepositoryRecord } from './record-types.js';
import { loadCanonicalRecords } from './parser.js';

export interface LearningsRepositoryContext {
  repoPath: string;
  repositoryId: string;
  repositorySlug: string;
  repositoryName: string;
  remoteUrl?: string;
  existingRecord?: RepositoryRecord;
}

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

  return {
    repoPath: resolvedRepoPath,
    repositoryId,
    repositorySlug,
    repositoryName,
    remoteUrl: existingRecord?.remote_url ?? readRemoteUrl(resolvedRepoPath),
    existingRecord
  };
}

export function buildRepositoryRecord(
  context: LearningsRepositoryContext
): RepositoryRecord {
  const now = new Date().toISOString();

  return {
    type: 'repository',
    sourcePath: `learnings/repositories/${context.repositoryId}.yaml`,
    id: context.repositoryId,
    slug: context.repositorySlug,
    name: context.repositoryName,
    local_path: context.repoPath,
    remote_url: context.remoteUrl,
    is_active: true,
    created_at: context.existingRecord?.created_at ?? now,
    updated_at: now
  };
}

export function getRepositoryRecordPath(
  context: LearningsRepositoryContext
): string {
  return path.join(
    context.repoPath,
    'learnings',
    'repositories',
    `${context.repositoryId}.yaml`
  );
}

export function ensureLearningsDirectories(
  context: LearningsRepositoryContext
): string[] {
  const directories = [
    path.join(context.repoPath, 'learnings'),
    path.join(context.repoPath, 'learnings', 'repositories'),
    path.join(context.repoPath, 'learnings', 'evidence', context.repositoryId),
    path.join(context.repoPath, 'learnings', 'lessons', context.repositoryId)
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

export function writeRepositoryRecord(context: LearningsRepositoryContext): {
  filePath: string;
  created: boolean;
} {
  const record = buildRepositoryRecord(context);
  const filePath = getRepositoryRecordPath(context);
  const created = !fs.existsSync(filePath);

  fs.writeFileSync(
    filePath,
    stringifySimpleYaml({
      id: record.id,
      slug: record.slug,
      name: record.name,
      local_path: record.local_path,
      remote_url: record.remote_url,
      is_active: record.is_active,
      created_at: record.created_at,
      updated_at: record.updated_at
    })
  );

  return { filePath, created };
}

function assertDirectoryExists(repoPath: string): void {
  if (!fs.existsSync(repoPath)) {
    throw new Error(`Repository path does not exist: ${repoPath}`);
  }

  if (!fs.statSync(repoPath).isDirectory()) {
    throw new Error(`Repository path is not a directory: ${repoPath}`);
  }
}

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
    `Expected a single repository record in ${repoPath}/learnings/repositories but found ${dataset.repositories.length}`
  );
}

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
