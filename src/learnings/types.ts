// Public-facing query types returned by `queryLearnings`. These are read-only
// projections of the SQLite data—separate from the canonical JSONL record types.

/** Controls how many results `queryLearnings` returns. */
export interface LearningsSearchOptions {
  limit?: number;
}

/** A single piece of source evidence attached to a query result. */
export interface LearningsQueryEvidence {
  id: string;
  url?: string;
  sourceType: string;
  title?: string;
  content: string;
  finalWeight?: number;
}

/** A fully hydrated learning returned by `queryLearnings`, including its evidence and tags. */
export interface LearningsQueryResult {
  id: string;
  title?: string;
  kind: string;
  statement: string;
  rationale?: string;
  applicability?: string;
  confidence?: number;
  status: string;
  tags: string[];
  evidence: LearningsQueryEvidence[];
}
