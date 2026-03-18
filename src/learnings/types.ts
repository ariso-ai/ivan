// Public-facing query types returned by `queryLearnings`. These are read-only
// projections of the SQLite data—separate from the canonical JSONL record types.

/** Controls how many results `queryLearnings` returns. */
export interface LearningsSearchOptions {
  limit?: number;
}

/** A fully hydrated learning returned by `queryLearnings`. */
export interface LearningsQueryResult {
  id: string;
  title?: string;
  kind: string;
  statement: string;
  rationale?: string;
  applicability?: string;
  confidence?: number;
  status: string;
  source_url?: string;
}
