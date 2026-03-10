import path from 'path';
import { LearningsDataset } from './record-types.js';
import { isStableRecordId } from './id.js';

export class LearningsValidationError extends Error {
  issues: string[];

  constructor(issues: string[]) {
    super(`Invalid learnings records:\n- ${issues.join('\n- ')}`);
    this.name = 'LearningsValidationError';
    this.issues = issues;
  }
}

export function validateLearningsDataset(dataset: LearningsDataset): void {
  const issues: string[] = [];

  if (dataset.repositories.length === 0) {
    issues.push(
      'No repository records found under learnings/repositories. Run "ivan learnings init --repo <path>" first.'
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

    const expectedFileName = `${repository.id}${path.extname(repository.sourcePath)}`;
    if (path.posix.basename(repository.sourcePath) !== expectedFileName) {
      issues.push(
        `${repository.sourcePath}: repository file name should match the id (${expectedFileName})`
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

    const expectedDir = evidence.repository_id;
    if (
      path.posix.basename(path.posix.dirname(evidence.sourcePath)) !==
      expectedDir
    ) {
      issues.push(
        `${evidence.sourcePath}: evidence must live under learnings/evidence/${expectedDir}/`
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
        `${learning.sourcePath}: learning statement must not be empty (expected a ## Statement section)`
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

    const expectedDir = learning.repository_id;
    if (
      path.posix.basename(path.posix.dirname(learning.sourcePath)) !==
      expectedDir
    ) {
      issues.push(
        `${learning.sourcePath}: learning must live under learnings/lessons/${expectedDir}/`
      );
    }
  }

  if (issues.length > 0) {
    throw new LearningsValidationError(issues);
  }
}
