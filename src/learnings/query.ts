// Full-text and vector search over the learnings SQLite database.
// Search strategy: vector cosine similarity → FTS5 BM25 → LIKE fallback,
// trying each tier until results are found.

import { openLearningsDatabase } from './database.js';
import {
  cosineSimilarity,
  deserializeVector,
  embedText
} from './embeddings.js';
import type {
  LearningsQueryEvidence,
  LearningsQueryResult,
  LearningsSearchOptions
} from './types.js';

/** Raw SQLite row shape returned by learning search queries. */
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

/** Extends `LearningRow` with the serialized embedding vector for cosine scoring. */
interface VectorLearningRow extends LearningRow {
  vector_json: string;
}

/**
 * Searches the learnings database for records relevant to `text`, hydrating each result
 * with its tags and evidence.  Opens the DB read-only and closes it before returning.
 */
export function queryLearnings(
  repoPath: string,
  text: string,
  options: LearningsSearchOptions = {}
): LearningsQueryResult[] {
  const searchText = text.trim();
  if (!searchText) {
    throw new Error('Query text must not be empty');
  }

  const db = openLearningsDatabase(repoPath, { readonly: true });

  try {
    const limit = options.limit ?? 5;
    const rows = runLearningSearch(db, searchText, limit);
    const tagStatement = db.prepare(
      `
        SELECT tag
        FROM learning_tags
        WHERE learning_id = ?
        ORDER BY tag
      `
    );
    const evidenceStatement = db.prepare(
      `
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
      `
    );

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
      ).map((evidenceRow): LearningsQueryEvidence =>
        withOptionalFields<LearningsQueryEvidence>(
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

      return withOptionalFields<LearningsQueryResult>(
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
  } finally {
    db.close();
  }
}

/**
 * Tries vector search, then FTS5, then LIKE in order, returning the first non-empty result set.
 * This cascade ensures useful results even for short or non-word queries.
 */
function runLearningSearch(
  db: ReturnType<typeof openLearningsDatabase>,
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

/**
 * Embeds `text`, loads all active learning vectors, computes cosine similarity,
 * filters results below 0.12, and returns the top `limit` rows by score then confidence.
 */
function runVectorSearch(
  db: ReturnType<typeof openLearningsDatabase>,
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

  const scoredRows = rows
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

  return scoredRows;
}

/**
 * Converts query text into a space-separated FTS5 MATCH expression by extracting
 * unique lowercase terms longer than one character.  Returns null if no valid terms exist.
 */
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
