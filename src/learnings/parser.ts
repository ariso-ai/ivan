// Reads all canonical JSONL files from a repository's `learnings/` directory and
// deserializes them into typed in-memory records.  The parser is additive: missing
// optional fields are silently dropped rather than treated as errors.

import fs from 'fs';
import path from 'path';
import type {
  EvidenceRecord,
  LearningsDataset,
  LearningRecord,
  RepositoryRecord
} from './record-types.js';

type JsonlRecord = Record<string, unknown>;

/** Reads and sorts all three JSONL record types for `repoPath`, returning a combined `LearningsDataset`. */
export function loadCanonicalRecords(repoPath: string): LearningsDataset {
  const resolvedRepoPath = path.resolve(repoPath);

  return sortDataset({
    repositories: readRepositoryRecords(resolvedRepoPath),
    evidence: readEvidenceRecords(resolvedRepoPath),
    learnings: readLearningRecords(resolvedRepoPath)
  });
}

/** Parses `learnings/repositories.jsonl` into `RepositoryRecord[]`; returns `[]` if the file is absent. */
function readRepositoryRecords(repoPath: string): RepositoryRecord[] {
  const filePath = path.join(repoPath, 'learnings', 'repositories.jsonl');
  return readJsonlFile(filePath, repoPath, (sourcePath, record) =>
    withOptionalFields<RepositoryRecord>(
      {
        type: 'repository',
        sourcePath,
        id: getRequiredString(record, 'id', sourcePath),
        slug: getRequiredString(record, 'slug', sourcePath),
        name: getRequiredString(record, 'name', sourcePath),
        is_active: getOptionalBoolean(record, 'is_active') ?? true,
        created_at: getRequiredString(record, 'created_at', sourcePath),
        updated_at: getRequiredString(record, 'updated_at', sourcePath)
      },
      {
        local_path: getOptionalString(record, 'local_path'),
        remote_url: getOptionalString(record, 'remote_url')
      }
    )
  );
}

/** Reads all `.jsonl` files under `learnings/evidence/` and parses them into `EvidenceRecord[]`. */
function readEvidenceRecords(repoPath: string): EvidenceRecord[] {
  const evidenceRoot = path.join(repoPath, 'learnings', 'evidence');
  if (!fs.existsSync(evidenceRoot)) {
    return [];
  }

  return collectJsonlFiles(evidenceRoot).flatMap((filePath) =>
    readJsonlFile(filePath, repoPath, (sourcePath, record) =>
      withOptionalFields<EvidenceRecord>(
        {
          type: 'evidence',
          sourcePath,
          id: getRequiredString(record, 'id', sourcePath),
          repository_id: getRequiredString(record, 'repository_id', sourcePath),
          source_system: getRequiredString(record, 'source_system', sourcePath),
          source_type: getRequiredString(record, 'source_type', sourcePath),
          content: getRequiredString(record, 'content', sourcePath),
          boosts: getStringArray(record, 'boosts'),
          penalties: getStringArray(record, 'penalties'),
          created_at: getRequiredString(record, 'created_at', sourcePath),
          updated_at: getRequiredString(record, 'updated_at', sourcePath)
        },
        {
          external_id: getOptionalString(record, 'external_id'),
          parent_external_id: getOptionalString(record, 'parent_external_id'),
          url: getOptionalString(record, 'url'),
          pr_number: getOptionalNumber(record, 'pr_number'),
          review_id: getOptionalString(record, 'review_id'),
          thread_id: getOptionalString(record, 'thread_id'),
          comment_id: getOptionalString(record, 'comment_id'),
          author_type: getOptionalString(record, 'author_type'),
          author_name: getOptionalString(record, 'author_name'),
          author_role: getOptionalString(record, 'author_role'),
          title: getOptionalString(record, 'title'),
          file_path: getOptionalString(record, 'file_path'),
          line_start: getOptionalNumber(record, 'line_start'),
          line_end: getOptionalNumber(record, 'line_end'),
          review_state: getOptionalString(record, 'review_state'),
          resolution_state: getOptionalString(record, 'resolution_state'),
          occurred_at: getOptionalString(record, 'occurred_at'),
          base_weight: getOptionalNumber(record, 'base_weight'),
          final_weight: getOptionalNumber(record, 'final_weight')
        }
      )
    )
  );
}

/** Reads all `.jsonl` files under `learnings/lessons/` and parses them into `LearningRecord[]`. */
function readLearningRecords(repoPath: string): LearningRecord[] {
  const lessonsRoot = path.join(repoPath, 'learnings', 'lessons');
  if (!fs.existsSync(lessonsRoot)) {
    return [];
  }

  return collectJsonlFiles(lessonsRoot).flatMap((filePath) =>
    readJsonlFile(filePath, repoPath, (sourcePath, record) =>
      withOptionalFields<LearningRecord>(
        {
          type: 'learning',
          sourcePath,
          id: getRequiredString(record, 'id', sourcePath),
          repository_id: getRequiredString(record, 'repository_id', sourcePath),
          kind: getRequiredString(record, 'kind', sourcePath),
          statement: getRequiredString(record, 'statement', sourcePath),
          status: getOptionalString(record, 'status') ?? 'active',
          evidence_ids: getStringArray(record, 'evidence_ids'),
          tags: getStringArray(record, 'tags'),
          created_at: getRequiredString(record, 'created_at', sourcePath),
          updated_at: getRequiredString(record, 'updated_at', sourcePath)
        },
        {
          source_type: getOptionalString(record, 'source_type'),
          title: getOptionalString(record, 'title'),
          rationale: getOptionalString(record, 'rationale'),
          applicability: getOptionalString(record, 'applicability'),
          confidence: getOptionalNumber(record, 'confidence')
        }
      )
    )
  );
}

/**
 * Reads a JSONL file line by line, calls `parser` with a `{file}#L{n}` source path per line,
 * and accumulates results.  Empty lines and absent files are silently skipped.
 */
function readJsonlFile<T>(
  filePath: string,
  repoPath: string,
  parser: (sourcePath: string, record: JsonlRecord) => T
): T[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const sourceFile = toCanonicalPath(repoPath, filePath);
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  const records: T[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index].trim();
    if (!rawLine) {
      continue;
    }

    const parsed = JSON.parse(rawLine) as JsonlRecord;
    records.push(parser(`${sourceFile}#L${index + 1}`, parsed));
  }

  return records;
}

/** Returns the absolute paths of all `.jsonl` files in `directory`, sorted by name. */
function collectJsonlFiles(directory: string): string[] {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => path.join(directory, entry.name));
}

/** Reads a string field that must be present and non-empty; throws with `sourcePath` context if missing. */
function getRequiredString(
  record: JsonlRecord,
  key: string,
  sourcePath: string
): string {
  const value = getOptionalString(record, key);
  if (!value) {
    throw new Error(`Missing required field "${key}" in ${sourcePath}`);
  }

  return value;
}

/** Returns a trimmed string value or `undefined` when the field is absent, null, an array, or blank. */
function getOptionalString(
  record: JsonlRecord,
  key: string
): string | undefined {
  const value = record[key];
  if (value === undefined || value === null || Array.isArray(value)) {
    return undefined;
  }

  return String(value).trim() || undefined;
}

/** Coerces a JSON value to a number; throws on non-numeric strings; returns `undefined` for absent/null. */
function getOptionalNumber(
  record: JsonlRecord,
  key: string
): number | undefined {
  const value = record[key];
  if (value === undefined || value === null || Array.isArray(value)) {
    return undefined;
  }

  if (typeof value === "number") {
    return value;
  }

  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Expected numeric field "${key}"`);
  }

  return parsed;
}

/** Parses a boolean field accepting `true`/`false` literals and their string equivalents. */
function getOptionalBoolean(
  record: JsonlRecord,
  key: string
): boolean | undefined {
  const value = record[key];
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

/** Returns a `string[]` from a JSON field, gracefully handling missing, scalar, or array values. */
function getStringArray(record: JsonlRecord, key: string): string[] {
  const value = record[key];
  if (value === undefined || value === null || value === '') {
    return [];
  }

  if (!Array.isArray(value)) {
    return [String(value).trim()].filter(Boolean);
  }

  return value.map((item) => String(item).trim()).filter(Boolean);
}

/** Converts an absolute file path to a forward-slash relative path from `repoPath`. */
function toCanonicalPath(repoPath: string, filePath: string): string {
  return path.relative(repoPath, filePath).split(path.sep).join('/');
}

/** Sorts each record list in a dataset by `sourcePath` then `id` for consistent ordering across calls. */
function sortDataset(dataset: LearningsDataset): LearningsDataset {
  return {
    repositories: [...dataset.repositories].sort(sortByPathThenId),
    evidence: [...dataset.evidence].sort(sortByPathThenId),
    learnings: [...dataset.learnings].sort(sortByPathThenId)
  };
}

/** Comparator that orders by `sourcePath` first, then `id`, both lexicographically. */
function sortByPathThenId(
  left: { sourcePath: string; id: string },
  right: { sourcePath: string; id: string }
): number {
  return (
    left.sourcePath.localeCompare(right.sourcePath) ||
    left.id.localeCompare(right.id)
  );
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
