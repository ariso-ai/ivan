import path from 'path';
import { InvariantViolation } from './errors.js';
import type { CanonicalDataset as LearningsDataset } from './models.js';
import { isStableRecordId } from './ids.js';

export function validateLearningsDataset(dataset: LearningsDataset): void {
  const issues: string[] = [];

  if (dataset.repositories.length === 0) {
    issues.push(
      'No repository records found under learnings/repositories.jsonl. Run "ivan learnings init --repo <path>" first.'
    );
  }

  const repositoryIds = new Set<string>();
  const evidenceIds = new Set<string>();
  const learningIds = new Set<string>();

  for (const repository of dataset.repositories) {
    if (!isStableRecordId(repository.id, 'repo')) {
      issues.push(
        `${repository.sourcePath}: repository id "${repository.id}" must start with "repo_"`
      );
    }

    if (repositoryIds.has(repository.id)) {
      issues.push(
        `${repository.sourcePath}: duplicate repository id "${repository.id}"`
      );
    }
    repositoryIds.add(repository.id);

    if (!repository.slug.trim()) {
      issues.push(`${repository.sourcePath}: slug must not be empty`);
    }

    if (!repository.name.trim()) {
      issues.push(`${repository.sourcePath}: name must not be empty`);
    }

    const repositorySourceFile = repository.sourcePath.split('#')[0];
    if (repositorySourceFile !== 'learnings/repositories.jsonl') {
      issues.push(
        `${repository.sourcePath}: repository must live in learnings/repositories.jsonl`
      );
    }
  }

  for (const evidence of dataset.evidence) {
    if (!isStableRecordId(evidence.id, 'ev')) {
      issues.push(
        `${evidence.sourcePath}: evidence id "${evidence.id}" must start with "ev_"`
      );
    }

    if (evidenceIds.has(evidence.id)) {
      issues.push(
        `${evidence.sourcePath}: duplicate evidence id "${evidence.id}"`
      );
    }
    evidenceIds.add(evidence.id);

    if (!repositoryIds.has(evidence.repository_id)) {
      issues.push(
        `${evidence.sourcePath}: repository_id "${evidence.repository_id}" does not match any repository record`
      );
    }

    if (!evidence.content.trim()) {
      issues.push(`${evidence.sourcePath}: evidence content must not be empty`);
    }

    const evidenceSourceFile = evidence.sourcePath.split('#')[0];
    const expectedFileName = `${evidence.repository_id}.jsonl`;
    if (
      path.posix.basename(path.posix.dirname(evidenceSourceFile)) !==
        'evidence' ||
      path.posix.basename(evidenceSourceFile) !== expectedFileName
    ) {
      issues.push(
        `${evidence.sourcePath}: evidence must live in learnings/evidence/${expectedFileName}`
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
      issues.push(
        `${learning.sourcePath}: duplicate learning id "${learning.id}"`
      );
    }
    learningIds.add(learning.id);

    if (!repositoryIds.has(learning.repository_id)) {
      issues.push(
        `${learning.sourcePath}: repository_id "${learning.repository_id}" does not match any repository record`
      );
    }

    if (!learning.statement.trim()) {
      issues.push(
        `${learning.sourcePath}: learning statement must not be empty`
      );
    }

    if (learning.evidence_ids.length === 0) {
      issues.push(
        `${learning.sourcePath}: learning must reference at least one evidence id`
      );
    }

    for (const evidenceId of learning.evidence_ids) {
      if (!evidenceIds.has(evidenceId)) {
        issues.push(
          `${learning.sourcePath}: evidence_id "${evidenceId}" does not match any evidence record`
        );
      }
    }

    const learningSourceFile = learning.sourcePath.split('#')[0];
    const expectedFileName = `${learning.repository_id}.jsonl`;
    if (
      path.posix.basename(path.posix.dirname(learningSourceFile)) !==
        'lessons' ||
      path.posix.basename(learningSourceFile) !== expectedFileName
    ) {
      issues.push(
        `${learning.sourcePath}: learning must live in learnings/lessons/${expectedFileName}`
      );
    }
  }

  if (issues.length > 0) {
    throw new InvariantViolation({ issues });
  }
}
