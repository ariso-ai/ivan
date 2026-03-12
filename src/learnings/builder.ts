// Rebuilds the learnings SQLite database from scratch by reading all canonical JSONL files,
// validating them, and inserting records inside a single transaction.
// This is intentionally a full-replace build (not an incremental migration).

import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import type {
  EvidenceRecord,
  LearningsDataset,
  LearningRecord,
  RepositoryRecord
} from './record-types.js';
import {
  createFreshLearningsDatabase,
  getLearningsDbPath,
  openLearningsDatabase
} from './database.js';
import { buildLearningEmbedding, serializeVector } from './embeddings.js';
import { loadCanonicalRecords } from './parser.js';
import { validateLearningsDataset } from './validator.js';

/** Counts and path returned after a successful database rebuild. */
export interface LearningsBuildResult {
  dbPath: string;
  repositoryCount: number;
  evidenceCount: number;
  learningCount: number;
}

/**
 * Validates all canonical JSONL records, then creates a fresh SQLite database,
 * bulk-inserts everything in one transaction, and populates the FTS tables.
 */
export function rebuildLearningsDatabase(
  repoPath: string
): LearningsBuildResult {
  const dataset = loadCanonicalRecords(repoPath);
  validateLearningsDataset(dataset);

  const db = createFreshLearningsDatabase(repoPath);

  try {
    insertDataset(db, dataset);
    populateFtsTables(db);
    storeJsonlHash(db, computeJsonlHash(repoPath));

    return {
      dbPath: getLearningsDbPath(repoPath),
      repositoryCount: dataset.repositories.length,
      evidenceCount: dataset.evidence.length,
      learningCount: dataset.learnings.length
    };
  } finally {
    db.close();
  }
}

/**
 * Returns true when `learnings.db` is absent or its stored JSONL hash does not match
 * the current hash of the canonical JSONL files. Used by the pre-commit hook to skip
 * unnecessary rebuilds.
 */
export function isLearningsDatabaseStale(repoPath: string): boolean {
  const dbPath = getLearningsDbPath(repoPath);
  if (!fs.existsSync(dbPath)) {
    return true;
  }

  const currentHash = computeJsonlHash(repoPath);

  try {
    const db = openLearningsDatabase(repoPath, { readonly: true });
    try {
      const row = db
        .prepare('SELECT value FROM meta WHERE key = ?')
        .get('jsonl_hash') as { value: string } | undefined;
      return !row || row.value !== currentHash;
    } finally {
      db.close();
    }
  } catch {
    return true;
  }
}

/**
 * Computes a SHA-256 digest over the sorted paths and contents of all canonical
 * JSONL files (repositories, evidence, lessons). Returns an empty string when
 * the learnings directory does not exist.
 */
export function computeJsonlHash(repoPath: string): string {
  const resolved = path.resolve(repoPath);
  const learningsDir = path.join(resolved, 'learnings');

  if (!fs.existsSync(learningsDir)) {
    return '';
  }

  const files: string[] = [];

  const repoFile = path.join(learningsDir, 'repositories.jsonl');
  if (fs.existsSync(repoFile)) {
    files.push(repoFile);
  }

  for (const subdir of ['evidence', 'lessons']) {
    const dir = path.join(learningsDir, subdir);
    if (fs.existsSync(dir)) {
      for (const entry of fs.readdirSync(dir).sort()) {
        if (entry.endsWith('.jsonl')) {
          files.push(path.join(dir, entry));
        }
      }
    }
  }

  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(path.relative(resolved, file));
    hash.update('\0');
    hash.update(fs.readFileSync(file));
    hash.update('\0');
  }

  return hash.digest('hex');
}

/**
 * Inserts all repositories, evidence, learnings, embeddings, and tag/evidence join rows
 * in a single SQLite transaction for atomicity and performance.
 */
function insertDataset(db: Database.Database, dataset: LearningsDataset): void {
  const insertRepository = db.prepare(`
    INSERT INTO repositories (
      id,
      slug,
      name,
      local_path,
      remote_url,
      is_active,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertEvidence = db.prepare(`
    INSERT INTO evidence (
      id,
      repository_id,
      source_system,
      source_type,
      external_id,
      parent_external_id,
      url,
      pr_number,
      review_id,
      thread_id,
      comment_id,
      author_type,
      author_name,
      author_role,
      title,
      content,
      file_path,
      line_start,
      line_end,
      review_state,
      resolution_state,
      occurred_at,
      base_weight,
      final_weight,
      boosts_json,
      penalties_json,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertLearning = db.prepare(`
    INSERT INTO learnings (
      id,
      repository_id,
      kind,
      source_type,
      title,
      statement,
      rationale,
      applicability,
      confidence,
      status,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertLearningEvidence = db.prepare(`
    INSERT INTO learning_evidence (
      learning_id,
      evidence_id,
      relationship_type,
      contribution_weight,
      extraction_reason,
      created_at
    ) VALUES (?, ?, 'supports', ?, ?, ?)
  `);

  const insertLearningTag = db.prepare(`
    INSERT INTO learning_tags (
      learning_id,
      tag,
      source,
      weight,
      created_at
    ) VALUES (?, ?, 'inferred', NULL, ?)
  `);

  const insertLearningEmbedding = db.prepare(`
    INSERT INTO learning_embeddings (
      learning_id,
      model,
      dimensions,
      vector_json,
      created_at
    ) VALUES (?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    for (const repository of sortRecords(dataset.repositories)) {
      writeRepository(insertRepository, repository);
    }

    for (const evidence of sortRecords(dataset.evidence)) {
      writeEvidence(insertEvidence, evidence);
    }

    for (const learning of sortRecords(dataset.learnings)) {
      writeLearning(insertLearning, learning);
      writeLearningEmbedding(insertLearningEmbedding, learning);

      for (const evidenceId of [...learning.evidence_ids].sort((a, b) =>
        a.localeCompare(b)
      )) {
        insertLearningEvidence.run(
          learning.id,
          evidenceId,
          null,
          `Linked from ${learning.sourcePath}`,
          learning.created_at
        );
      }

      for (const tag of [...learning.tags].sort((a, b) => a.localeCompare(b))) {
        insertLearningTag.run(learning.id, tag, learning.created_at);
      }
    }
  });

  transaction();
}

/** Builds a local embedding for `learning` and inserts it into the `learning_embeddings` table. */
function writeLearningEmbedding(
  statement: Database.Statement,
  learning: LearningRecord
): void {
  const embedding = buildLearningEmbedding(learning);
  statement.run(
    learning.id,
    embedding.model,
    embedding.dimensions,
    serializeVector(embedding.vector),
    learning.updated_at
  );
}

/** Executes the prepared `INSERT INTO repositories` statement for one record. */
function writeRepository(
  statement: Database.Statement,
  repository: RepositoryRecord
): void {
  statement.run(
    repository.id,
    repository.slug,
    repository.name,
    repository.local_path ?? null,
    repository.remote_url ?? null,
    repository.is_active ? 1 : 0,
    repository.created_at,
    repository.updated_at
  );
}

/** Executes the prepared `INSERT INTO evidence` statement, serializing boosts/penalties arrays as JSON. */
function writeEvidence(
  statement: Database.Statement,
  evidence: EvidenceRecord
): void {
  statement.run(
    evidence.id,
    evidence.repository_id,
    evidence.source_system,
    evidence.source_type,
    evidence.external_id ?? null,
    evidence.parent_external_id ?? null,
    evidence.url ?? null,
    evidence.pr_number ?? null,
    evidence.review_id ?? null,
    evidence.thread_id ?? null,
    evidence.comment_id ?? null,
    evidence.author_type ?? null,
    evidence.author_name ?? null,
    evidence.author_role ?? null,
    evidence.title ?? null,
    evidence.content,
    evidence.file_path ?? null,
    evidence.line_start ?? null,
    evidence.line_end ?? null,
    evidence.review_state ?? null,
    evidence.resolution_state ?? null,
    evidence.occurred_at ?? null,
    evidence.base_weight ?? null,
    evidence.final_weight ?? null,
    JSON.stringify(evidence.boosts),
    JSON.stringify(evidence.penalties),
    evidence.created_at,
    evidence.updated_at
  );
}

/** Executes the prepared `INSERT INTO learnings` statement for one record. */
function writeLearning(
  statement: Database.Statement,
  learning: LearningRecord
): void {
  statement.run(
    learning.id,
    learning.repository_id,
    learning.kind,
    learning.source_type ?? null,
    learning.title ?? null,
    learning.statement,
    learning.rationale ?? null,
    learning.applicability ?? null,
    learning.confidence ?? null,
    learning.status,
    learning.created_at,
    learning.updated_at
  );
}

/** Clears and re-populates both FTS5 virtual tables (`evidence_fts`, `learnings_fts`) from their base tables. */
function populateFtsTables(db: Database.Database): void {
  db.exec('DELETE FROM evidence_fts');
  db.exec('DELETE FROM learnings_fts');

  db.exec(`
    INSERT INTO evidence_fts (id, repository_id, source_type, title, content)
    SELECT id, repository_id, source_type, COALESCE(title, ''), content
    FROM evidence
    ORDER BY id
  `);

  db.exec(`
    INSERT INTO learnings_fts (
      id,
      repository_id,
      kind,
      title,
      statement,
      rationale,
      applicability
    )
    SELECT
      id,
      repository_id,
      kind,
      COALESCE(title, ''),
      statement,
      COALESCE(rationale, ''),
      COALESCE(applicability, '')
    FROM learnings
    ORDER BY id
  `);
}

/** Writes the JSONL content hash into the `meta` table so staleness checks can compare it later. */
function storeJsonlHash(db: Database.Database, hash: string): void {
  db.prepare(
    'INSERT OR REPLACE INTO meta (key, value, updated_at) VALUES (?, ?, ?)'
  ).run('jsonl_hash', hash, new Date().toISOString());
}

/** Sorts records by `sourcePath` then `id` to produce deterministic insertion order. */
function sortRecords<T extends { id: string; sourcePath: string }>(
  records: T[]
): T[] {
  return [...records].sort(
    (left, right) =>
      left.sourcePath.localeCompare(right.sourcePath) ||
      left.id.localeCompare(right.id)
  );
}
