import fs from 'fs';
import path from 'path';
import {
  EvidenceRecord,
  LearningsDataset,
  LearningRecord,
  RepositoryRecord
} from './record-types.js';
import { parseFrontmatterDocument, parseSimpleYaml } from './frontmatter.js';
import { LearningsFrontmatter } from './types.js';

export function loadCanonicalRecords(repoPath: string): LearningsDataset {
  const resolvedRepoPath = path.resolve(repoPath);
  const repositories = readRepositoryRecords(resolvedRepoPath);
  const evidence = readMarkdownRecords(
    resolvedRepoPath,
    path.join('learnings', 'evidence'),
    parseEvidenceRecord
  );
  const learnings = readMarkdownRecords(
    resolvedRepoPath,
    path.join('learnings', 'lessons'),
    parseLearningRecord
  );

  return sortDataset({
    repositories,
    evidence,
    learnings
  });
}

function readRepositoryRecords(repoPath: string): RepositoryRecord[] {
  const repositoryDir = path.join(repoPath, 'learnings', 'repositories');
  if (!fs.existsSync(repositoryDir)) {
    return [];
  }

  return fs
    .readdirSync(repositoryDir)
    .filter((fileName) => /\.(yaml|yml)$/i.test(fileName))
    .sort((left, right) => left.localeCompare(right))
    .map((fileName) => {
      const filePath = path.join(repositoryDir, fileName);
      const sourcePath = toCanonicalPath(repoPath, filePath);
      const frontmatter = parseSimpleYaml(fs.readFileSync(filePath, 'utf8'));
      return parseRepositoryRecord(sourcePath, frontmatter);
    });
}

function readMarkdownRecords<T>(
  repoPath: string,
  relativeRoot: string,
  parser: (
    sourcePath: string,
    frontmatter: LearningsFrontmatter,
    body: string
  ) => T
): T[] {
  const absoluteRoot = path.join(repoPath, relativeRoot);
  if (!fs.existsSync(absoluteRoot)) {
    return [];
  }

  return collectFiles(absoluteRoot, '.md').map((filePath) => {
    const sourcePath = toCanonicalPath(repoPath, filePath);
    const { frontmatter, body } = parseFrontmatterDocument(
      fs.readFileSync(filePath, 'utf8')
    );
    return parser(sourcePath, frontmatter, body);
  });
}

function collectFiles(directory: string, extension: string): string[] {
  const entries = fs
    .readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(fullPath, extension));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(extension)) {
      files.push(fullPath);
    }
  }

  return files;
}

function parseRepositoryRecord(
  sourcePath: string,
  frontmatter: LearningsFrontmatter
): RepositoryRecord {
  return {
    type: 'repository',
    sourcePath,
    id: getRequiredString(frontmatter, 'id', sourcePath),
    slug: getRequiredString(frontmatter, 'slug', sourcePath),
    name: getRequiredString(frontmatter, 'name', sourcePath),
    local_path: getOptionalString(frontmatter, 'local_path'),
    remote_url: getOptionalString(frontmatter, 'remote_url'),
    is_active: getOptionalBoolean(frontmatter, 'is_active') ?? true,
    created_at: getRequiredString(frontmatter, 'created_at', sourcePath),
    updated_at: getRequiredString(frontmatter, 'updated_at', sourcePath)
  };
}

function parseEvidenceRecord(
  sourcePath: string,
  frontmatter: LearningsFrontmatter,
  body: string
): EvidenceRecord {
  return {
    type: 'evidence',
    sourcePath,
    id: getRequiredString(frontmatter, 'id', sourcePath),
    repository_id: getRequiredString(frontmatter, 'repository_id', sourcePath),
    source_system: getRequiredString(frontmatter, 'source_system', sourcePath),
    source_type: getRequiredString(frontmatter, 'source_type', sourcePath),
    external_id: getOptionalString(frontmatter, 'external_id'),
    parent_external_id: getOptionalString(frontmatter, 'parent_external_id'),
    url: getOptionalString(frontmatter, 'url'),
    pr_number: getOptionalNumber(frontmatter, 'pr_number'),
    review_id: getOptionalString(frontmatter, 'review_id'),
    thread_id: getOptionalString(frontmatter, 'thread_id'),
    comment_id: getOptionalString(frontmatter, 'comment_id'),
    author_type: getOptionalString(frontmatter, 'author_type'),
    author_name: getOptionalString(frontmatter, 'author_name'),
    author_role: getOptionalString(frontmatter, 'author_role'),
    title: getOptionalString(frontmatter, 'title'),
    content: body.trim(),
    file_path: getOptionalString(frontmatter, 'file_path'),
    line_start: getOptionalNumber(frontmatter, 'line_start'),
    line_end: getOptionalNumber(frontmatter, 'line_end'),
    review_state: getOptionalString(frontmatter, 'review_state'),
    resolution_state: getOptionalString(frontmatter, 'resolution_state'),
    occurred_at: getOptionalString(frontmatter, 'occurred_at'),
    base_weight: getOptionalNumber(frontmatter, 'base_weight'),
    final_weight: getOptionalNumber(frontmatter, 'final_weight'),
    boosts: getStringArray(frontmatter, 'boosts'),
    penalties: getStringArray(frontmatter, 'penalties'),
    created_at: getRequiredString(frontmatter, 'created_at', sourcePath),
    updated_at: getRequiredString(frontmatter, 'updated_at', sourcePath)
  };
}

function parseLearningRecord(
  sourcePath: string,
  frontmatter: LearningsFrontmatter,
  body: string
): LearningRecord {
  const sections = parseLearningSections(body);

  return {
    type: 'learning',
    sourcePath,
    id: getRequiredString(frontmatter, 'id', sourcePath),
    repository_id: getRequiredString(frontmatter, 'repository_id', sourcePath),
    kind: getRequiredString(frontmatter, 'kind', sourcePath),
    source_type: getOptionalString(frontmatter, 'source_type'),
    title: getOptionalString(frontmatter, 'title'),
    statement: sections.statement,
    rationale: sections.rationale,
    applicability: sections.applicability,
    confidence: getOptionalNumber(frontmatter, 'confidence'),
    status: getOptionalString(frontmatter, 'status') ?? 'active',
    evidence_ids: getStringArray(frontmatter, 'evidence_ids'),
    tags: getStringArray(frontmatter, 'tags'),
    created_at: getRequiredString(frontmatter, 'created_at', sourcePath),
    updated_at: getRequiredString(frontmatter, 'updated_at', sourcePath)
  };
}

function parseLearningSections(body: string): {
  statement: string;
  rationale?: string;
  applicability?: string;
} {
  const normalized = body.trim();
  if (!normalized) {
    return { statement: '' };
  }

  const headings = [...normalized.matchAll(/^##\s+(.+)\s*$/gm)];
  if (headings.length === 0) {
    return { statement: normalized };
  }

  const sections = new Map<string, string>();

  for (let index = 0; index < headings.length; index += 1) {
    const currentHeading = headings[index];
    const nextHeading = headings[index + 1];
    const sectionName = currentHeading[1].trim().toLowerCase();
    let sectionStart = (currentHeading.index ?? 0) + currentHeading[0].length;

    if (normalized[sectionStart] === '\n') {
      sectionStart += 1;
    }

    const sectionEnd = nextHeading?.index ?? normalized.length;
    const content = normalized.slice(sectionStart, sectionEnd).trim();
    sections.set(sectionName, content);
  }

  return {
    statement: sections.get('statement') ?? '',
    rationale: sections.get('rationale') || undefined,
    applicability: sections.get('applicability') || undefined
  };
}

function getRequiredString(
  frontmatter: LearningsFrontmatter,
  key: string,
  sourcePath: string
): string {
  const value = getOptionalString(frontmatter, key);
  if (!value) {
    throw new Error(`Missing required field "${key}" in ${sourcePath}`);
  }

  return value;
}

function getOptionalString(
  frontmatter: LearningsFrontmatter,
  key: string
): string | undefined {
  const value = frontmatter[key];
  if (value === undefined || value === null || Array.isArray(value)) {
    return undefined;
  }

  return String(value).trim() || undefined;
}

function getOptionalNumber(
  frontmatter: LearningsFrontmatter,
  key: string
): number | undefined {
  const value = frontmatter[key];
  if (value === undefined || value === null || Array.isArray(value)) {
    return undefined;
  }

  if (typeof value === 'number') {
    return value;
  }

  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Expected numeric field "${key}"`);
  }

  return parsed;
}

function getOptionalBoolean(
  frontmatter: LearningsFrontmatter,
  key: string
): boolean | undefined {
  const value = frontmatter[key];
  if (value === undefined || value === null || Array.isArray(value)) {
    return undefined;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  throw new Error(`Expected boolean field "${key}"`);
}

function getStringArray(
  frontmatter: LearningsFrontmatter,
  key: string
): string[] {
  const value = frontmatter[key];
  if (value === undefined || value === null || value === '') {
    return [];
  }

  if (!Array.isArray(value)) {
    return [String(value)];
  }

  return value.map((item) => String(item).trim()).filter(Boolean);
}

function toCanonicalPath(repoPath: string, filePath: string): string {
  return path.relative(repoPath, filePath).split(path.sep).join('/');
}

function sortDataset(dataset: LearningsDataset): LearningsDataset {
  return {
    repositories: [...dataset.repositories].sort(sortByPathThenId),
    evidence: [...dataset.evidence].sort(sortByPathThenId),
    learnings: [...dataset.learnings].sort(sortByPathThenId)
  };
}

function sortByPathThenId(
  left: { sourcePath: string; id: string },
  right: { sourcePath: string; id: string }
): number {
  return (
    left.sourcePath.localeCompare(right.sourcePath) ||
    left.id.localeCompare(right.id)
  );
}
