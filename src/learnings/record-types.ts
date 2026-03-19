// Canonical record types persisted as JSONL files under `.ivan/`.
// These are the source-of-truth data structures; the SQLite database is a
// derived, rebuilable index built from these files.

/** Shared fields present on every record in the learnings store. */
export interface CanonicalRecord {
  id: string;
  type: 'evidence' | 'learning';
  created_at: string;
  updated_at: string;
}

/** In-memory signal derived from a GitHub PR payload. Never written to disk. */
export interface EvidenceSignal extends CanonicalRecord {
  type: 'evidence';
  source_system: string;
  /** Narrows the evidence kind: `pull_request`, `pr_review_thread`, `pr_review`, `pr_issue_comment`, `pr_check`. */
  source_type: string;
  external_url?: string;
  parent_url?: string;
  author_name?: string;
  author_type?: string;
  occurred_at?: string;
  /**
   * Raw weight assigned by evidence type before boosts or penalties.
   * See `weighting.ts` for the scoring functions that produce these values.
   *
   * | source_type / condition              | base_weight | Notes                              |
   * |--------------------------------------|-------------|------------------------------------|
   * | pr_review (CHANGES_REQUESTED)        | 6           | Actionable feedback                |
   * | pr_review_thread (unresolved)        | 5           | Still-open issue                   |
   * | pr_check (failure / error)           | 4           | CI failure signal                  |
   * | pr_review_thread (resolved)          | 3           | Addressed inline thread            |
   * | pr_issue_comment                     | 3           | General PR discussion              |
   * | pr_review (APPROVED / COMMENTED)     | 2           | Verdict without actionable content |
   * | pr_check (passing)                   | 1           | Low signal; not extracted          |
   */
  base_weight?: number;
  /**
   * Final weight after applying boosts and penalties.
   * Evidence is extracted into a learning when `final_weight >= 3` (see `extractor.ts`).
   * Confidence is derived as `0.35 + min(final_weight, 12) / 20` → [0.35, 0.95].
   *
   * **Boosts** (added to `base_weight`)
   * | Label                  | Condition                                          |
   * |------------------------|----------------------------------------------------|
   * | `changes_requested`    | Review state is CHANGES_REQUESTED                  |
   * | `approved`             | Review state is APPROVED                           |
   * | `unresolved_thread`    | Review thread is not yet resolved                  |
   * | `inline_code_comment`  | Thread is diff-anchored (has a file path)          |
   *
   * **Penalties** (subtracted from `base_weight`, floored at 0)
   * | Label                  | Δ  | Condition                                        |
   * |------------------------|----|--------------------------------------------------|
   * | `low_signal_text`      | −2 | Body starts with `nit:`, `style:`, or `typo:`   |
   * | `outdated_thread`      | —  | Thread marked outdated (label only, no Δ)        |
   * | `review_comment_only`  | —  | Review state is COMMENTED (label only, no Δ)     |
   */
  final_weight?: number;
  /** Labels that increased the signal value (e.g. `changes_requested`, `unresolved_thread`). */
  boosts: string[];
  /** Labels that decreased the signal value (e.g. `low_signal_text`, `outdated_thread`). */
  penalties: string[];
}

/** In-memory content for an evidence signal. Never written to disk. */
export interface EvidenceContext {
  title?: string;
  content: string;
  diff_hunk?: string;
  file_path?: string;
  line_start?: number;
  line_end?: number;
}

/** Maps evidence signal id to its in-memory content. */
export type EvidenceContextCache = Map<string, EvidenceContext>;

/** An extracted engineering insight derived from one or more evidence records. */
export interface LearningRecord extends CanonicalRecord {
  type: 'learning';
  /** Relative path within the repo (e.g. `.ivan/lessons.jsonl#L3`). */
  sourcePath: string;
  /** `repo_convention` for project-specific rules; `engineering_lesson` for general patterns. */
  kind: string;
  source_type?: string;
  title?: string;
  /** The actionable statement distilled from the evidence. */
  statement: string;
  rationale?: string;
  applicability?: string;
  /** 0.35–0.95; derived from `final_weight` via `inferConfidence`. */
  confidence?: number;
  status: string;
  /** GitHub URL of the PR that generated this learning. */
  source_url?: string;
  /** Cached 1536-dim embedding vector from `text-embedding-3-small`. */
  embedding?: number[];
  /** SHA-256 hex of the embedding input string; used to detect content changes. */
  embeddingInputHash?: string;
}

/** The full in-memory view of all canonical JSONL data for one repo. */
export interface LearningsDataset {
  learnings: LearningRecord[];
}
