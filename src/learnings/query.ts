import { openLearningsDatabase } from './database.js';
import {
  LearningsQueryEvidence,
  LearningsQueryResult,
  LearningsSearchOptions
} from './types.js';

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
      ).map(
        (evidenceRow): LearningsQueryEvidence => ({
          id: evidenceRow.id,
          url: evidenceRow.url ?? undefined,
          sourceType: evidenceRow.source_type,
          title: evidenceRow.title ?? undefined,
          content: evidenceRow.content,
          finalWeight: evidenceRow.final_weight ?? undefined
        })
      );

      return {
        id: row.id,
        repositoryId: row.repository_id,
        title: row.title ?? undefined,
        kind: row.kind,
        statement: row.statement,
        rationale: row.rationale ?? undefined,
        applicability: row.applicability ?? undefined,
        confidence: row.confidence ?? undefined,
        status: row.status,
        tags,
        evidence
      };
    });
  } finally {
    db.close();
  }
}

function runLearningSearch(
  db: ReturnType<typeof openLearningsDatabase>,
  text: string,
  limit: number
): LearningRow[] {
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
