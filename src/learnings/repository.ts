import fs from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';
import Database from 'better-sqlite3';
import { Context, Effect, Layer } from 'effect';
import {
  InvalidQueryLimit,
  LearningsPersistenceError,
  MissingLearningsDatabase,
  QueryTextEmpty
} from './errors.js';
import type {
  CanonicalDataset,
  EvidenceRecord,
  LearningRecord,
  LearningView,
  QueryRequest,
  RebuildResult,
  RepositoryRecord
} from './models.js';
import type { LearningsError } from './errors.js';
import { validateLearningsDataset } from './validator.js';
import {
  buildLearningEmbedding,
  cosineSimilarity,
  deserializeVector,
  embedText,
  serializeVector
} from './embeddings.js';

export class LearningsRepository extends Context.Tag(
  'learnings/LearningsRepository'
)<
  LearningsRepository,
  {
    readonly rebuildFromCanonical: (
      dbPath: string,
      dataset: CanonicalDataset
    ) => Effect.Effect<RebuildResult, LearningsError>;
    readonly query: (
      request: QueryRequest
    ) => Effect.Effect<ReadonlyArray<LearningView>, LearningsError>;
  }
>() {}

const SCHEMA_SQL = fs.readFileSync(
  new URL('./schema.sql', import.meta.url),
  'utf8'
);

interface LearningRow {
  id: string;
  repository_id: string;
  title: string | null;
  kind: string;
  statement: string;
  rationale: string | null;
  applicability: string | null;
  confidence: number | null;
  status: string;
}

interface VectorLearningRow extends LearningRow {
  vector_json: string;
}

export const LearningsRepositoryLive = Layer.succeed(LearningsRepository, {
  rebuildFromCanonical: Effect.fn('LearningsRepository.rebuildFromCanonical')(
    function* (dbPath: string, dataset: CanonicalDataset) {
      yield* Effect.try({
        try: () => validateLearningsDataset(dataset),
        catch: (error) =>
          toPersistenceError('validate canonical dataset', error)
      });

      const db = yield* openFreshDatabase(dbPath);

      try {
        yield* Effect.try({
          try: () => {
            insertDataset(db, dataset);
            populateFtsTables(db);
          },
          catch: (error) =>
            toPersistenceError(`rebuild sqlite database at ${dbPath}`, error)
        });
      } finally {
        db.close();
      }

      return {
        dbPath,
        repositoryCount: dataset.repositories.length,
        evidenceCount: dataset.evidence.length,
        learningCount: dataset.learnings.length
      } satisfies RebuildResult;
    }
  ),

  query: Effect.fn('LearningsRepository.query')(function* (
    request: QueryRequest
  ) {
    const searchText = request.text.trim();
    if (searchText.length === 0) {
      return yield* Effect.fail(new QueryTextEmpty({}));
    }

    const limit = request.limit ?? 5;
    if (!Number.isInteger(limit) || limit <= 0) {
      return yield* Effect.fail(new InvalidQueryLimit({ limit }));
    }

    const dbPath = path.join(path.resolve(request.repoPath), 'learnings.db');
    if (!fs.existsSync(dbPath)) {
      return yield* Effect.fail(new MissingLearningsDatabase({ dbPath }));
    }

    const db = yield* openExistingDatabase(dbPath, { readonly: true });

    try {
      return yield* Effect.try({
        try: () => runQuery(db, searchText, limit),
        catch: (error) =>
          toPersistenceError(`query sqlite database at ${dbPath}`, error)
      });
    } finally {
      db.close();
    }
  })
});

function openFreshDatabase(
  dbPath: string
): Effect.Effect<Database.Database, LearningsPersistenceError> {
  return Effect.try({
    try: () => {
      removeDatabaseArtifacts(dbPath);
      const db = new Database(dbPath);
      db.pragma('journal_mode = DELETE');
      db.pragma('foreign_keys = ON');
      db.exec(SCHEMA_SQL);
      return db;
    },
    catch: (error) =>
      toPersistenceError(`open fresh sqlite database at ${dbPath}`, error)
  });
}

function openExistingDatabase(
  dbPath: string,
  options: { readonly?: boolean } = {}
): Effect.Effect<Database.Database, LearningsPersistenceError> {
  return Effect.try({
    try: () => {
      const db = new Database(dbPath, {
        readonly: options.readonly ?? false,
        fileMustExist: true
      });
      db.pragma('foreign_keys = ON');
      return db;
    },
    catch: (error) =>
      toPersistenceError(`open sqlite database at ${dbPath}`, error)
  });
}

function runQuery(
  db: Database.Database,
  text: string,
  limit: number
): LearningView[] {
  const rows = runLearningSearch(db, text, limit);
  const tagStatement = db.prepare(`
    SELECT tag
    FROM learning_tags
    WHERE learning_id = ?
    ORDER BY tag
  `);
  const evidenceStatement = db.prepare(`
    SELECT
      e.id,
      e.url,
      e.source_type,
      e.title,
      e.content,
      e.final_weight
    FROM learning_evidence le
    INNER JOIN evidence e ON e.id = le.evidence_id
    WHERE le.learning_id = ?
    ORDER BY COALESCE(le.contribution_weight, e.final_weight, 0) DESC, e.id ASC
  `);

  return rows.map((row) => {
    const tags = (tagStatement.all(row.id) as Array<{ tag: string }>).map(
      (tagRow) => tagRow.tag
    );
    const evidence = (
      evidenceStatement.all(row.id) as Array<{
        id: string;
        url: string | null;
        source_type: string;
        title: string | null;
        content: string;
        final_weight: number | null;
      }>
    ).map((evidenceRow) =>
      withOptionalFields(
        {
          id: evidenceRow.id,
          sourceType: evidenceRow.source_type,
          content: evidenceRow.content
        },
        {
          url: evidenceRow.url ?? undefined,
          title: evidenceRow.title ?? undefined,
          finalWeight: evidenceRow.final_weight ?? undefined
        }
      )
    );

    return withOptionalFields(
      {
        id: row.id,
        repositoryId: row.repository_id,
        kind: row.kind,
        statement: row.statement,
        status: row.status,
        tags,
        evidence
      },
      {
        title: row.title ?? undefined,
        rationale: row.rationale ?? undefined,
        applicability: row.applicability ?? undefined,
        confidence: row.confidence ?? undefined
      }
    );
  });
}

function runLearningSearch(
  db: Database.Database,
  text: string,
  limit: number
): LearningRow[] {
  const vectorRows = runVectorSearch(db, text, limit);
  if (vectorRows.length > 0) {
    return vectorRows;
  }

  const ftsExpression = buildFtsExpression(text);
  if (ftsExpression) {
    const ftsRows = db
      .prepare(
        `
        SELECT
          l.id,
          l.repository_id,
          l.title,
          l.kind,
          l.statement,
          l.rationale,
          l.applicability,
          l.confidence,
          l.status,
          bm25(learnings_fts) AS rank
        FROM learnings_fts
        INNER JOIN learnings l ON l.id = learnings_fts.id
        WHERE learnings_fts MATCH ?
        ORDER BY rank ASC, COALESCE(l.confidence, 0) DESC, l.updated_at DESC
        LIMIT ?
      `
      )
      .all(ftsExpression, limit) as Array<LearningRow & { rank: number }>;

    if (ftsRows.length > 0) {
      return ftsRows;
    }
  }

  const likePattern = `%${text}%`;
  return db
    .prepare(
      `
      SELECT
        id,
        repository_id,
        title,
        kind,
        statement,
        rationale,
        applicability,
        confidence,
        status
      FROM learnings
      WHERE statement LIKE ?
        OR COALESCE(title, '') LIKE ?
        OR COALESCE(rationale, '') LIKE ?
        OR COALESCE(applicability, '') LIKE ?
      ORDER BY COALESCE(confidence, 0) DESC, updated_at DESC
      LIMIT ?
    `
    )
    .all(
      likePattern,
      likePattern,
      likePattern,
      likePattern,
      limit
    ) as LearningRow[];
}

function runVectorSearch(
  db: Database.Database,
  text: string,
  limit: number
): LearningRow[] {
  const queryVector = embedText(text);
  const rows = db
    .prepare(
      `
      SELECT
        l.id,
        l.repository_id,
        l.title,
        l.kind,
        l.statement,
        l.rationale,
        l.applicability,
        l.confidence,
        l.status,
        le.vector_json
      FROM learning_embeddings le
      INNER JOIN learnings l ON l.id = le.learning_id
      WHERE l.status = 'active'
    `
    )
    .all() as VectorLearningRow[];

  return rows
    .map((row) => ({
      row,
      score: cosineSimilarity(queryVector, deserializeVector(row.vector_json))
    }))
    .filter((candidate) => candidate.score >= 0.12)
    .sort((left, right) => {
      return (
        right.score - left.score ||
        (right.row.confidence ?? 0) - (left.row.confidence ?? 0) ||
        right.row.id.localeCompare(left.row.id)
      );
    })
    .slice(0, limit)
    .map((candidate) => candidate.row);
}

function insertDataset(db: Database.Database, dataset: CanonicalDataset): void {
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

function buildFtsExpression(text: string): string | null {
  const terms = Array.from(
    new Set(
      (text.toLowerCase().match(/[a-z0-9_]+/g) ?? []).filter(
        (term) => term.length > 1
      )
    )
  );

  if (terms.length === 0) {
    return null;
  }

  return terms.join(' ');
}

function removeDatabaseArtifacts(dbPath: string): void {
  for (const candidate of [dbPath, `${dbPath}-shm`, `${dbPath}-wal`]) {
    if (fs.existsSync(candidate)) {
      fs.unlinkSync(candidate);
    }
  }
}

function sortRecords<T extends { id: string; sourcePath: string }>(
  records: ReadonlyArray<T>
): T[] {
  return [...records].sort(
    (left, right) =>
      left.sourcePath.localeCompare(right.sourcePath) ||
      left.id.localeCompare(right.id)
  );
}

function toPersistenceError(
  operation: string,
  error: unknown
): LearningsPersistenceError {
  return new LearningsPersistenceError({
    operation,
    message: error instanceof Error ? error.message : String(error)
  });
}

function withOptionalFields<T extends object>(
  base: T,
  optionalFields: Record<string, unknown>
): T {
  const result: Record<string, unknown> = {
    ...(base as Record<string, unknown>)
  };

  for (const [key, value] of Object.entries(optionalFields)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }

  return result as T;
}
