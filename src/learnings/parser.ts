// Reads the canonical JSONL file from a repository's `.ivan/` directory and
// deserializes it into typed in-memory records.  The parser is additive: missing
// optional fields are silently dropped rather than treated as errors.

import fs from 'fs';
import path from 'path';
import { resolveCanonicalLearningsPath } from './paths.js';
import type {
  LearningsDataset,
  LearningRecord
} from './record-types.js';

type JsonlRecord = Record<string, unknown>;

/** Reads and sorts the canonical lessons JSONL for `repoPath`, returning a `LearningsDataset`. */
export function loadCanonicalRecords(repoPath: string): LearningsDataset {
  const resolvedRepoPath = path.resolve(repoPath);
  return {
    learnings: readLearningRecords(resolvedRepoPath).sort(sortByPathThenId)
  };
}

/** Reads `.ivan/lessons.jsonl` and parses it into `LearningRecord[]`. */
function readLearningRecords(repoPath: string): LearningRecord[] {
  const filePath = resolveCanonicalLearningsPath(repoPath, 'lessons.jsonl');
  return readJsonlFile(filePath, repoPath, (sourcePath, record) => ({
    type: 'learning' as const,
    sourcePath,
    id: getRequiredString(record, 'id', sourcePath),
    kind: getRequiredString(record, 'kind', sourcePath),
    statement: getRequiredString(record, 'statement', sourcePath),
    status: getOptionalString(record, 'status') ?? 'active',
    tags: getStringArray(record, 'tags'),
    created_at: getRequiredString(record, 'created_at', sourcePath),
    updated_at: getRequiredString(record, 'updated_at', sourcePath),
    ...omitUndefined({
      source_type: getOptionalString(record, 'source_type'),
      source_url: getOptionalString(record, 'source_url'),
      title: getOptionalString(record, 'title'),
      rationale: getOptionalString(record, 'rationale'),
      applicability: getOptionalString(record, 'applicability'),
      confidence: getOptionalNumber(record, 'confidence'),
      embedding: getOptionalNumberArray(record, 'embedding'),
      embeddingInputHash: getOptionalString(record, 'embeddingInputHash')
    })
  }) as LearningRecord);
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

/** Coerces a JSON value to a number; returns `undefined` for absent, null, blank, or non-finite values. */
function getOptionalNumber(
  record: JsonlRecord,
  key: string
): number | undefined {
  const value = record[key];
  if (value === undefined || value === null || Array.isArray(value)) {
    return undefined;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }

  const str = String(value).trim();
  if (str === '') {
    return undefined;
  }

  const parsed = Number(str);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Returns a `number[]` from a JSON field, or `undefined` when the field is absent or null. */
function getOptionalNumberArray(
  record: JsonlRecord,
  key: string
): number[] | undefined {
  const value = record[key];
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.map((item) => (typeof item === 'number' ? item : Number(item)));
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

/** Comparator that orders by `sourcePath` first, then `id`, both lexicographically. */
export function sortByPathThenId(
  left: { sourcePath: string; id: string },
  right: { sourcePath: string; id: string }
): number {
  return (
    left.sourcePath.localeCompare(right.sourcePath) ||
    left.id.localeCompare(right.id)
  );
}

/** Returns a copy of `obj` with all `undefined` values removed. */
function omitUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const result: Partial<T> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      (result as Record<string, unknown>)[key] = value;
    }
  }
  return result;
}
