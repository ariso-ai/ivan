// Rebuilds the learnings SQLite database from scratch by reading all canonical JSONL files,
// validating them, and inserting records inside a single transaction.
// This is intentionally a full-replace build (not an incremental migration).

import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { sql, type Kysely } from 'kysely';
import type {
  LearningsDataset,
  LearningRecord
} from './record-types.js';
import {
  createFreshLearningsDatabase,
  getLearningsDbPath,
  openLearningsDatabase,
  type LearningsDatabase
} from './database.js';
import {
  buildEmbeddingInputString,
  EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS,
  embedTexts
} from './embeddings.js';
import {
  LESSONS_JSONL_RELATIVE_PATH,
  resolveCanonicalLearningsPath
} from './paths.js';
import { loadCanonicalRecords, sortByPathThenId } from './parser.js';
import { validateLearningsDataset } from './validator.js';

/** Counts and path returned after a successful database rebuild. */
export interface LearningsBuildResult {
  dbPath: string;
  learningCount: number;
  embeddingsCached: number;
  embeddingsGenerated: number;
}

const EMBEDDING_BATCH_MAX_ITEMS = 64;
const EMBEDDING_BATCH_MAX_CHARS = 200_000;

/**
 * Validates all canonical JSONL records, then creates a fresh SQLite database
 * and bulk-inserts everything in one transaction.
 */
export async function rebuildLearningsDatabase(
  repoPath: string
): Promise<LearningsBuildResult> {
  const dataset = loadCanonicalRecords(repoPath);
  validateLearningsDataset(dataset);

  const { cached, generated, dirty } = await resolveEmbeddings(
    dataset.learnings
  );
  console.log(`Embeddings: ${cached} cached, ${generated} generated`);

  if (dirty) writeBackEmbeddings(repoPath, dataset.learnings);

  const dbPath = getLearningsDbPath(repoPath);
  const tmpPath = `${dbPath}.tmp`;
  const db = await createFreshLearningsDatabase(repoPath, tmpPath);

  try {
    await insertDataset(db, dataset);
    await storeJsonlHash(db, computeJsonlHash(repoPath));
    await db.destroy();
    fs.renameSync(tmpPath, dbPath);

    return {
      dbPath,
      learningCount: dataset.learnings.length,
      embeddingsCached: cached,
      embeddingsGenerated: generated
    };
  } catch (err) {
    await db.destroy();
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
export async function isLearningsDatabaseStale(repoPath: string): Promise<boolean> {
  const dbPath = getLearningsDbPath(repoPath);
  if (!fs.existsSync(dbPath)) {
    return true;
  }

  const currentHash = computeJsonlHash(repoPath);

  try {
    const db = openLearningsDatabase(repoPath, { readonly: true });
    try {
      const row = await db
        .selectFrom('meta')
        .select('value')
        .where('key', '=', 'jsonl_hash')
        .executeTakeFirst();
      return !row || row.value !== currentHash;
    } finally {
      await db.destroy();
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

  for (const relativePath of [LESSONS_JSONL_RELATIVE_PATH]) {
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
 * embedding input string. Cache hits reuse the stored vector; cache misses are generated
 * in bounded batches so a large rebuild does not exceed provider request limits.
 * Mutates records in-place. Returns hit/miss counts.
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
    for (const batch of chunkEmbeddingRequests(dirty)) {
      try {
        const vectors = await embedTexts(batch.map((item) => item.inputString));
        for (let i = 0; i < batch.length; i++) {
          batch[i].learning.embedding = vectors[i];
          batch[i].learning.embeddingInputHash = batch[i].hash;
        }
        generated += batch.length;
      } catch (err) {
        console.error(
          `Warning: could not generate embeddings for batch of ${batch.length} learning(s) (${(err as Error).message}). Those rows will be skipped for this rebuild.`
        );
      }
    }
  }

  return { cached, generated, dirty: generated > 0 };
}

function chunkEmbeddingRequests<T extends { inputString: string }>(items: T[]): T[][] {
  const batches: T[][] = [];
  let currentBatch: T[] = [];
  let currentChars = 0;

  for (const item of items) {
    const itemChars = item.inputString.length;
    const wouldOverflowItems = currentBatch.length >= EMBEDDING_BATCH_MAX_ITEMS;
    const wouldOverflowChars =
      currentBatch.length > 0 && currentChars + itemChars > EMBEDDING_BATCH_MAX_CHARS;

    if (wouldOverflowItems || wouldOverflowChars) {
      batches.push(currentBatch);
      currentBatch = [];
      currentChars = 0;
    }

    currentBatch.push(item);
    currentChars += itemChars;
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
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

  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, updatedLines.map((l) => `${l}\n`).join(''), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

/**
 * Inserts all evidence, learnings, embeddings, and tag/evidence join rows
 * in a single transaction for atomicity and performance.
 */
async function insertDataset(
  db: Kysely<LearningsDatabase>,
  dataset: LearningsDataset
): Promise<void> {
  await db.transaction().execute(async (trx) => {
    for (const learning of [...dataset.learnings].sort(sortByPathThenId)) {
      await trx
        .insertInto('learnings')
        .values({
          id: learning.id,
          kind: learning.kind,
          source_type: learning.source_type ?? null,
          source_url: learning.source_url ?? null,
          title: learning.title ?? null,
          statement: learning.statement,
          rationale: learning.rationale ?? null,
          applicability: learning.applicability ?? null,
          confidence: learning.confidence ?? null,
          status: learning.status,
          created_at: learning.created_at,
          updated_at: learning.updated_at
        })
        .execute();

      if (learning.embedding && learning.embedding.length > 0) {
        const vectorBuffer = Buffer.from(
          new Float32Array(learning.embedding).buffer
        );
        await sql`INSERT INTO learning_vectors (learning_id, vector) VALUES (${learning.id}, ${vectorBuffer})`.execute(
          trx
        );
      }
    }
  });
}

/** Writes the JSONL content hash into the `meta` table so staleness checks can compare it later. */
async function storeJsonlHash(
  db: Kysely<LearningsDatabase>,
  hash: string
): Promise<void> {
  await db
    .insertInto('meta')
    .values({ key: 'jsonl_hash', value: hash, updated_at: new Date().toISOString() })
    .onConflict((oc) =>
      oc.column('key').doUpdateSet({
        value: hash,
        updated_at: new Date().toISOString()
      })
    )
    .execute();
}
