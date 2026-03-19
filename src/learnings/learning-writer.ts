// Persists extracted LearningRecord objects to `.ivan/lessons.jsonl`.
// This is a full-replace write: the entire file is rewritten on each call.

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
  records: LearningRecord[]
): string[] {
  const filePath = resolveCanonicalLearningsPath(repoPath, 'lessons.jsonl');
  const normalizedRecords = [...records]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((record) => ({ ...record, sourcePath: learningSourcePath() }));

  const nextContent = normalizedRecords
    .map((record) => `${JSON.stringify(serializeLearningRecord(record))}\n`)
    .join('');
  fs.writeFileSync(filePath, nextContent, 'utf8');

  return normalizedRecords.map((_, index) => `${filePath}#L${index + 1}`);
}

/** Produces the plain-object form of a `LearningRecord` for JSON serialization, omitting `type` and `sourcePath`. */
function serializeLearningRecord(
  record: LearningRecord
): Omit<LearningRecord, 'type' | 'sourcePath'> {
  return {
    id: record.id,
    kind: record.kind,
    statement: record.statement,
    status: record.status,
    created_at: record.created_at,
    updated_at: record.updated_at,
    source_type: record.source_type,
    source_url: record.source_url,
    title: record.title,
    rationale: record.rationale,
    applicability: record.applicability,
    confidence: record.confidence,
    embedding: record.embedding,
    embeddingInputHash: record.embeddingInputHash
  };
}

/** Returns the canonical relative path for the lessons JSONL file (without a line number). */
function learningSourcePath(): string {
  return LESSONS_JSONL_RELATIVE_PATH;
}
