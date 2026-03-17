// Persists extracted LearningRecord objects to `.ivan/lessons.jsonl`.
// This is a full-replace write: the entire file for a repository is rewritten on each call.

import fs from 'fs';
import {
  LESSONS_JSONL_RELATIVE_PATH,
  resolveCanonicalLearningsPath
} from './paths.js';
import type { LearningRecord } from './record-types.js';

/**
 * Replaces this repository's records inside `.ivan/lessons.jsonl` and returns the `{file}#L{n}` paths.
 */
export function writeLearningRecords(
  repoPath: string,
  repositoryId: string,
  records: LearningRecord[]
): string[] {
  const filePath = resolveCanonicalLearningsPath(repoPath, 'lessons.jsonl');
  const normalizedRecords = mergeLearningRecords(filePath, repositoryId, records)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((record) => ({
      ...record,
      sourcePath: learningSourcePath()
    }));

  const nextContent = normalizedRecords
    .map((record) => `${JSON.stringify(serializeLearningRecord(record))}\n`)
    .join('');
  fs.writeFileSync(filePath, nextContent, 'utf8');

  return normalizedRecords.map((record, index) => `${filePath}#L${index + 1}`);
}

function mergeLearningRecords(
  filePath: string,
  repositoryId: string,
  records: LearningRecord[]
): LearningRecord[] {
  const keptRecords: LearningRecord[] = [];

  if (fs.existsSync(filePath)) {
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }

      const parsed = JSON.parse(line) as LearningRecord;
      if (parsed.repository_id !== repositoryId) {
        keptRecords.push(parsed);
      }
    }
  }

  return [...keptRecords, ...records];
}

/** Produces the plain-object form of a `LearningRecord` for JSON serialization, omitting `type` and `sourcePath`. */
function serializeLearningRecord(
  record: LearningRecord
): Omit<LearningRecord, 'type' | 'sourcePath'> {
  return withOptionalFields<Omit<LearningRecord, 'type' | 'sourcePath'>>({
    id: record.id,
    repository_id: record.repository_id,
    kind: record.kind,
    statement: record.statement,
    status: record.status,
    evidence_ids: record.evidence_ids,
    tags: record.tags,
    created_at: record.created_at,
    updated_at: record.updated_at
  }, {
    source_type: record.source_type,
    title: record.title,
    rationale: record.rationale,
    applicability: record.applicability,
    confidence: record.confidence,
    embedding: record.embedding,
    embeddingInputHash: record.embeddingInputHash
  });
}

/** Returns the canonical relative path for the lessons JSONL file (without a line number). */
function learningSourcePath(): string {
  return LESSONS_JSONL_RELATIVE_PATH;
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
