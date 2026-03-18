// Full-text and vector search over the learnings SQLite database.
// Search strategy: vector cosine similarity → FTS5 BM25 → LIKE fallback,
// trying each tier until results are found.

import { openLearningsDatabase } from './database.js';
import { embedText } from './embeddings.js';
import { omitUndefined } from './parser.js';
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

/**
 * Searches the learnings database for records relevant to `text`, hydrating each result
 * with its tags and evidence.  Opens the DB read-only and closes it before returning.
 */
export async function queryLearnings(
  repoPath: string,
  text: string,
  options: LearningsSearchOptions = {}
): Promise<LearningsQueryResult[]> {
  const searchText = text.trim();
  if (!searchText) {
    throw new Error('Query text must not be empty');
  }

  const db = openLearningsDatabase(repoPath, { readonly: true });

  try {
    const rawLimit = options.limit ?? 5;
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 5;
    const rows = await runLearningSearch(db, searchText, limit);
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
      ).map((evidenceRow) => ({
        id: evidenceRow.id,
        sourceType: evidenceRow.source_type,
        content: evidenceRow.content,
        ...omitUndefined({
          url: evidenceRow.url ?? undefined,
          title: evidenceRow.title ?? undefined,
          finalWeight: evidenceRow.final_weight ?? undefined
        })
      }) as LearningsQueryEvidence);

      return {
        id: row.id,
        repositoryId: row.repository_id,
        kind: row.kind,
        statement: row.statement,
        status: row.status,
        tags,
        evidence,
        ...omitUndefined({
          title: row.title ?? undefined,
          rationale: row.rationale ?? undefined,
          applicability: row.applicability ?? undefined,
          confidence: row.confidence ?? undefined
        })
      } as LearningsQueryResult;
    });
  } finally {
    db.close();
  }
}

/**
 * Tries vector search, then FTS5, then LIKE in order, returning the first non-empty result set.
 * This cascade ensures useful results even for short or non-word queries.
 */
async function runLearningSearch(
  db: ReturnType<typeof openLearningsDatabase>,
  text: string,
  limit: number
): Promise<LearningRow[]> {
  const vectorRows = await runVectorSearch(db, text, limit);
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
            AND l.status = 'active'
          ORDER BY rank ASC, COALESCE(l.confidence, 0) DESC, l.updated_at DESC
          LIMIT ?
        `
      )
      .all(ftsExpression, limit) as Array<LearningRow & { rank: number }>;

    if (ftsRows.length > 0) {
      return ftsRows;
    }
  }

  const escapedText = text.replace(/[%_\\]/g, '\\$&');
  const likePattern = `%${escapedText}%`;
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
        WHERE status = 'active'
          AND (
            statement LIKE ? ESCAPE '\\'
            OR COALESCE(title, '') LIKE ? ESCAPE '\\'
            OR COALESCE(rationale, '') LIKE ? ESCAPE '\\'
            OR COALESCE(applicability, '') LIKE ? ESCAPE '\\'
          )
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
 * Embeds `text` and runs a vec0 KNN cosine-distance query against `learning_vectors`,
 * filtering to active learnings only. Returns the top `limit` rows ordered by distance.
 */
async function runVectorSearch(
  db: ReturnType<typeof openLearningsDatabase>,
  text: string,
  limit: number
): Promise<LearningRow[]> {
  let queryVector: Buffer;
  try {
    queryVector = Buffer.from(new Float32Array(await embedText(text)).buffer);
  } catch {
    return []; // OpenAI unavailable — fall through to FTS5
  }

  return db
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
          l.status
        FROM learning_vectors lv
        INNER JOIN learnings l ON l.id = lv.learning_id
        WHERE lv.vector MATCH ?
          AND k = ?
          AND l.status = 'active'
        ORDER BY distance
      `
    )
    .all(queryVector, limit) as LearningRow[];
}

/**
 * Converts query text into a space-separated FTS5 MATCH expression by extracting
 * unique lowercase terms longer than one character.  Returns null if no valid terms exist.
 */
function buildFtsExpression(text: string): string | null {
  const terms = Array.from(
    new Set(
      (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
        (term) => term.length > 1
      )
    )
  );

  if (terms.length === 0) {
    return null;
  }

  return terms.join(' ');
}
