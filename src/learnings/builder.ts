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
import {
  buildEmbeddingInputString,
  EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS,
  embedTexts
} from './embeddings.js';
import {
  EVIDENCE_JSONL_RELATIVE_PATH,
  LESSONS_JSONL_RELATIVE_PATH,
  resolveCanonicalLearningsPath
} from './paths.js';
import { loadCanonicalRecords, sortByPathThenId } from './parser.js';
import { validateLearningsDataset } from './validator.js';

/** Counts and path returned after a successful database rebuild. */
export interface LearningsBuildResult {
  dbPath: string;
  repositoryCount: number;
  evidenceCount: number;
  learningCount: number;
  embeddingsCached: number;
  embeddingsGenerated: number;
}

/**
 * Validates all canonical JSONL records, then creates a fresh SQLite database,
 * bulk-inserts everything in one transaction, and populates the FTS tables.
 */
export async function rebuildLearningsDatabase(
  repoPath: string
): Promise<LearningsBuildResult> {
  const dataset = loadCanonicalRecords(repoPath);
  validateLearningsDataset(dataset);

  const { cached, generated, dirty } = await resolveEmbeddings(
    dataset.learnings
  );
  process.stderr.write(
    `Embeddings: ${cached} cached, ${generated} generated\n`
  );

  if (dirty) writeBackEmbeddings(repoPath, dataset.learnings);

  const dbPath = getLearningsDbPath(repoPath);
  const tmpPath = `${dbPath}.tmp`;
  const db = createFreshLearningsDatabase(repoPath, tmpPath);

  try {
    insertDataset(db, dataset);
    populateFtsTables(db);
    storeJsonlHash(db, computeJsonlHash(repoPath));
    db.close();
    fs.renameSync(tmpPath, dbPath);

    return {
      dbPath,
      repositoryCount: dataset.repositories.length,
      evidenceCount: dataset.evidence.length,
      learningCount: dataset.learnings.length,
      embeddingsCached: cached,
      embeddingsGenerated: generated
    };
  } catch (err) {
    db.close();
    if (fs.existsSync(tmpPath)) {
      fs.unlinkSync(tmpPath);
    }
    throw err;
  }
}

/**
 * Returns true when `.ivan/db.sqlite` is absent or its stored JSONL hash does not match
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
 * JSONL files (`evidence.jsonl`, `lessons.jsonl`). Returns an empty string when
 * the `.ivan` directory does not exist.
 */
export function computeJsonlHash(repoPath: string): string {
  const resolved = path.resolve(repoPath);
  const learningsDir = resolveCanonicalLearningsPath(resolved);

  if (!fs.existsSync(learningsDir)) {
    return '';
  }

  const files: string[] = [];

  for (const relativePath of [
    EVIDENCE_JSONL_RELATIVE_PATH,
    LESSONS_JSONL_RELATIVE_PATH
  ]) {
    const file = path.join(resolved, relativePath);
    if (fs.existsSync(file)) {
      files.push(file);
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
 * Checks each learning's cached embedding against a SHA-256 of the model version +
 * embedding input string. Cache hits reuse the stored vector; cache misses are batched
 * into a single OpenAI API call. Mutates records in-place. Returns hit/miss counts.
 *
 * Including EMBEDDING_MODEL in the hash ensures old caches (e.g. from the previous
 * local hash function) are automatically invalidated when the model changes.
 */
async function resolveEmbeddings(
  learnings: LearningRecord[]
): Promise<{ cached: number; generated: number; dirty: boolean }> {
  const dirty: Array<{
    learning: LearningRecord;
    inputString: string;
    hash: string;
  }> = [];
  let cached = 0;

  for (const learning of learnings) {
    const inputString = buildEmbeddingInputString(learning);
    const hash = createHash('sha256')
      .update(`${EMBEDDING_MODEL}@${EMBEDDING_DIMENSIONS}\n`)
      .update(inputString)
      .digest('hex');

    if (
      learning.embeddingInputHash === hash &&
      learning.embedding?.length === EMBEDDING_DIMENSIONS
    ) {
      cached += 1;
    } else {
      dirty.push({ learning, inputString, hash });
    }
  }

  let generated = 0;

  if (dirty.length > 0) {
    try {
      const vectors = await embedTexts(dirty.map((d) => d.inputString));
      for (let i = 0; i < dirty.length; i++) {
        dirty[i].learning.embedding = vectors[i];
        dirty[i].learning.embeddingInputHash = dirty[i].hash;
      }
      generated = dirty.length;
    } catch (err) {
      process.stderr.write(
        `Warning: could not generate embeddings (${(err as Error).message}). Vector search will be unavailable for this rebuild.\n`
      );
    }
  }

  return { cached, generated, dirty: generated > 0 };
}

/**
 * Rewrites the lessons JSONL file, merging the in-memory `embedding` and `embeddingInputHash`
 * fields back onto each line that matches by `id`. Non-learning lines are preserved as-is.
 */
function writeBackEmbeddings(
  repoPath: string,
  learnings: LearningRecord[]
): void {
  const filePath = resolveCanonicalLearningsPath(
    path.resolve(repoPath),
    'lessons.jsonl'
  );

  if (!fs.existsSync(filePath)) {
    return;
  }

  const learningById = new Map<string, LearningRecord>();
  for (const learning of learnings) {
    learningById.set(learning.id, learning);
  }

  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  const updatedLines: string[] = [];

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      continue;
    }

    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const id = typeof parsed['id'] === 'string' ? parsed['id'] : undefined;
    const learning = id !== undefined ? learningById.get(id) : undefined;

    if (learning !== undefined) {
      parsed['embedding'] = learning.embedding;
      parsed['embeddingInputHash'] = learning.embeddingInputHash;
    }

    updatedLines.push(JSON.stringify(parsed));
  }

  // write to a temporary file and rename to avoid partial writes
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, updatedLines.map((l) => `${l}\n`).join(''), 'utf8');
  fs.renameSync(tmpPath, filePath);
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

  const insertLearningVector = db.prepare(`
    INSERT INTO learning_vectors (learning_id, vector) VALUES (?, ?)
  `);

  const transaction = db.transaction(() => {
    for (const repository of [...dataset.repositories].sort(sortByPathThenId)) {
      writeRepository(insertRepository, repository);
    }

    for (const evidence of [...dataset.evidence].sort(sortByPathThenId)) {
      writeEvidence(insertEvidence, evidence);
    }

    for (const learning of [...dataset.learnings].sort(sortByPathThenId)) {
      writeLearning(insertLearning, learning);
      if (learning.embedding && learning.embedding.length > 0) {
        writeLearningVector(insertLearningVector, learning);
      }

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

/** Inserts the pre-resolved embedding as a Float32Array buffer into the `learning_vectors` vec0 table. */
function writeLearningVector(
  statement: Database.Statement,
  learning: LearningRecord
): void {
  if (!learning.embedding || learning.embedding.length === 0) {
    throw new Error(
      `Learning ${learning.id} is missing its embedding — call resolveEmbeddings before insertDataset`
    );
  }
  statement.run(learning.id, Buffer.from(new Float32Array(learning.embedding).buffer));
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
