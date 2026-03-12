// Persists extracted LearningRecord objects to JSONL files under `learnings/lessons/`.
// This is a full-replace write: the entire file for a repository is rewritten on each call.

import fs from 'fs';
import path from 'path';
import type { LearningRecord } from './record-types.js';

/**
 * Sorts `records` by id, writes them to `learnings/lessons/{repositoryId}.jsonl`,
 * removes any legacy per-repository directory, and returns the `{file}#L{n}` paths.
 */
export function writeLearningRecords(
  repoPath: string,
  repositoryId: string,
  records: LearningRecord[]
): string[] {
  const lessonsDir = path.join(repoPath, 'learnings', 'lessons');
  fs.mkdirSync(lessonsDir, { recursive: true });

  const filePath = path.join(lessonsDir, `${repositoryId}.jsonl`);
  const normalizedRecords = [...records]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((record) => ({
      ...record,
      sourcePath: learningSourcePath(repositoryId)
    }));

  const nextContent = normalizedRecords
    .map((record) => `${JSON.stringify(serializeLearningRecord(record))}\n`)
    .join('');
  fs.writeFileSync(filePath, nextContent, 'utf8');
  removeLegacyLessonsDirectory(repoPath, repositoryId);

  return normalizedRecords.map((record, index) => `${filePath}#L${index + 1}`);
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
    confidence: record.confidence
  });
}

/** Returns the canonical relative path for a learnings JSONL file (without a line number). */
function learningSourcePath(repositoryId: string): string {
  return `learnings/lessons/${repositoryId}.jsonl`;
}

/** Removes the old per-repository lessons directory (`learnings/lessons/{id}/`) from a prior schema version. */
function removeLegacyLessonsDirectory(repoPath: string, repositoryId: string): void {
  const legacyDirectory = path.join(repoPath, 'learnings', 'lessons', repositoryId);
  if (!fs.existsSync(legacyDirectory)) {
    return;
  }

  fs.rmSync(legacyDirectory, { recursive: true, force: true });
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
