// Structural validation for the canonical JSONL dataset before it is used to build
// or query the SQLite database.  Throws early with a human-readable list of all
// issues so users can fix everything in one pass rather than one error at a time.

import type { LearningsDataset } from './record-types.js';
import { isStableRecordId } from './id.js';
import { EVIDENCE_JSONL_RELATIVE_PATH, LESSONS_JSONL_RELATIVE_PATH } from './paths.js';

/** Thrown by `validateLearningsDataset` when the dataset contains one or more structural problems. */
export class LearningsValidationError extends Error {
  /** Each string describes one broken invariant, formatted as `{sourcePath}: {reason}`. */
  issues: string[];

  constructor(issues: string[]) {
    super(`Invalid learnings records:\n- ${issues.join('\n- ')}`);
    this.name = 'LearningsValidationError';
    this.issues = issues;
  }
}

/**
 * Validates all three record types in `dataset` against the schema rules:
 * correct ID prefixes, no duplicates, valid cross-references, and correct file locations.
 * Throws `LearningsValidationError` listing every issue found; returns void on success.
 */
export function validateLearningsDataset(dataset: LearningsDataset): void {
  const issues: string[] = [];

  const evidenceIds = new Set<string>();
  const learningIds = new Set<string>();

  for (const evidence of dataset.evidence) {
    if (!isStableRecordId(evidence.id, 'ev')) {
      issues.push(
        `${evidence.sourcePath}: evidence id "${evidence.id}" must start with "ev_"`
      );
    }

    if (evidenceIds.has(evidence.id)) {
      issues.push(`${evidence.sourcePath}: duplicate evidence id "${evidence.id}"`);
    }
    evidenceIds.add(evidence.id);

    const evidenceSourceFile = evidence.sourcePath.split('#')[0];
    if (evidenceSourceFile !== EVIDENCE_JSONL_RELATIVE_PATH) {
      issues.push(
        `${evidence.sourcePath}: evidence must live in ${EVIDENCE_JSONL_RELATIVE_PATH}`
      );
    }
  }

  for (const learning of dataset.learnings) {
    if (!isStableRecordId(learning.id, 'lrn')) {
      issues.push(
        `${learning.sourcePath}: learning id "${learning.id}" must start with "lrn_"`
      );
    }

    if (learningIds.has(learning.id)) {
      issues.push(`${learning.sourcePath}: duplicate learning id "${learning.id}"`);
    }
    learningIds.add(learning.id);

    if (!learning.statement.trim()) {
      issues.push(`${learning.sourcePath}: learning statement must not be empty`);
    }

    if (learning.evidence_ids.length === 0) {
      issues.push(
        `${learning.sourcePath}: learning must reference at least one evidence id`
      );
    }

    const learningSourceFile = learning.sourcePath.split('#')[0];
    if (learningSourceFile !== LESSONS_JSONL_RELATIVE_PATH) {
      issues.push(
        `${learning.sourcePath}: learning must live in ${LESSONS_JSONL_RELATIVE_PATH}`
      );
    }
  }

  if (issues.length > 0) {
    throw new LearningsValidationError(issues);
  }
}
