// Vector search over the learnings SQLite database.

import { sql } from 'kysely';
import { openLearningsDatabase, type LearningsDatabase } from './database.js';
import { embedText } from './embeddings.js';
import type {
  LearningsQueryEvidence,
  LearningsQueryResult,
  LearningsSearchOptions
} from './types.js';
import type { Kysely } from 'kysely';

/** Raw row shape returned by the vec0 KNN query. */
interface VectorLearningRow {
  id: string;
  title: string | null;
  kind: string;
  statement: string;
  rationale: string | null;
  applicability: string | null;
  confidence: number | null;
  status: string;
  distance: number;
}

const MIN_VECTOR_SIMILARITY = 0.12;

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
    const vectorRows = await runVectorSearch(db, searchText, limit);

    return await Promise.all(
      vectorRows.map(async ({ distance: _distance, ...row }) => {
        const tagRows = await db
          .selectFrom('learning_tags')
          .select('tag')
          .where('learning_id', '=', row.id)
          .orderBy('tag', 'asc')
          .execute();

        const evidenceRows = await db
          .selectFrom('learning_evidence as le')
          .innerJoin('evidence as e', 'e.id', 'le.evidence_id')
          .select(['e.id', 'e.external_url', 'e.source_type', 'e.final_weight'])
          .where('le.learning_id', '=', row.id)
          .orderBy(sql`COALESCE(le.contribution_weight, e.final_weight, 0)`, 'desc')
          .orderBy('e.id', 'asc')
          .execute();

        const evidence: LearningsQueryEvidence[] = evidenceRows.map((e) => ({
          id: e.id,
          sourceType: e.source_type,
          url: e.external_url ?? undefined,
          finalWeight: e.final_weight ?? undefined
        }));

        return {
          id: row.id,
          kind: row.kind,
          statement: row.statement,
          status: row.status,
          tags: tagRows.map((t) => t.tag),
          evidence,
          title: row.title ?? undefined,
          rationale: row.rationale ?? undefined,
          applicability: row.applicability ?? undefined,
          confidence: row.confidence ?? undefined
        };
      })
    );
  } finally {
    await db.destroy();
  }
}

async function runVectorSearch(
  db: Kysely<LearningsDatabase>,
  text: string,
  limit: number
): Promise<VectorLearningRow[]> {
  let queryVector: Buffer;
  try {
    queryVector = Buffer.from(new Float32Array(await embedText(text)).buffer);
  } catch {
    return [];
  }

  const { rows } = await sql<VectorLearningRow>`
    SELECT
      l.id,
      l.title,
      l.kind,
      l.statement,
      l.rationale,
      l.applicability,
      l.confidence,
      l.status,
      distance
    FROM learning_vectors lv
    INNER JOIN learnings l ON l.id = lv.learning_id
    WHERE lv.vector MATCH ${queryVector}
      AND k = ${limit}
      AND l.status = 'active'
    ORDER BY distance
  `.execute(db);

  return rows.filter(
    (row) => Number.isFinite(row.distance) && 1 - row.distance >= MIN_VECTOR_SIMILARITY
  );
}
