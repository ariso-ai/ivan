// Canonical record types persisted as JSONL files under `.ivan/`.
// These are the source-of-truth data structures; the SQLite database is a
// derived, rebuilable index built from these files.

/** Shared fields present on every record in the learnings store. */
export interface CanonicalRecord {
  id: string;
  type: 'repository' | 'evidence' | 'learning';
  /** Relative path within the repo (e.g. `.ivan/evidence.jsonl#L3`). */
  sourcePath: string;
  created_at: string;
  updated_at: string;
}

/** Synthetic repository record derived from the target repo path and git metadata. */
export interface RepositoryRecord extends CanonicalRecord {
  type: 'repository';
  slug: string;
  name: string;
  local_path?: string;
  remote_url?: string;
  is_active: boolean;
}

/** One atomic piece of feedback or signal from GitHub (PR, review thread, issue comment, check). */
export interface EvidenceRecord extends CanonicalRecord {
  type: 'evidence';
  repository_id: string;
  source_system: string;
  /** Narrows the evidence kind: `pull_request`, `pr_review_thread`, `pr_review`, `pr_issue_comment`, `pr_check`. */
  source_type: string;
  external_id?: string;
  parent_external_id?: string;
  url?: string;
  pr_number?: number;
  review_id?: string;
  thread_id?: string;
  comment_id?: string;
  author_type?: string;
  author_name?: string;
  author_role?: string;
  title?: string;
  content: string;
  file_path?: string;
  line_start?: number;
  line_end?: number;
  review_state?: string;
  resolution_state?: string;
  occurred_at?: string;
  /**
   * Raw weight assigned by evidence type before boosts or penalties.
   *
   * | source_type               | base_weight | Notes                                      |
   * |---------------------------|-------------|--------------------------------------------|
   * | pr_review (with text)     | 6           | Already a structured mini-distillation     |
   * | pr_issue_comment (human)  | 5           | Often contains system-level reasoning      |
   * | pr_review_reply (author)  | 4           | Author ack is a strong usefulness proxy    |
   * | pr_review_comment (root)  | 3           | Local by nature; requires boosts           |
   * | pr_review_reply (other)   | 2           | Engagement signal; mainly a boost carrier  |
   * | pull_request (body para)  | 2           | Mostly context / risk / rollout notes      |
   * | pr_review (state only)    | 1           | Structured but weak without rationale      |
   * | pull_request (merge meta) | 1           | Corroboration only                         |
   */
  base_weight?: number;
  /**
   * Final weight after applying boosts and penalties. Used to filter evidence during
   * learning extraction (threshold: ≥ 12 to create a learning).
   *
   * **Boosts**
   * | Label                    | Δ    | Condition                                          |
   * |--------------------------|------|----------------------------------------------------|
   * | multi_participant        | +3   | 2+ distinct human participants in thread           |
   * | author_acknowledgement   | +2   | Author explicitly acknowledges the comment         |
   * | extra_replies            | +1–3 | Additional substantive replies (capped at +3)      |
   * | addressed_change         | +6   | Code change plausibly linked to this comment       |
   * | thread_resolved          | +2   | Thread marked resolved                             |
   * | pr_merged                | +1   | PR was merged                                      |
   * | generalizable_framing    | +2   | Uses "in general / prefer / avoid / guideline"     |
   *
   * **Penalties**
   * | Label                    | Δ    | Condition                                          |
   * |--------------------------|------|----------------------------------------------------|
   * | bot_author               | −8   | Actor is a bot or automation account               |
   * | nit_label                | −6   | Comment explicitly labeled `Nit:`                  |
   * | style_only               | −4   | Style/formatting/typo with no generalizable lesson |
   * | outdated_thread          | −3   | Thread is marked outdated                          |
   * | pr_closed_unmerged       | −3   | PR was closed without merging                      |
   *
   * **Confidence buckets** (derived from `final_weight`)
   * | Bucket  | Score     | Additional requirements                            |
   * |---------|-----------|---------------------------------------------------|
   * | high    | ≥ 14      | Addressed change signal + acknowledgement/multi    |
   * | medium  | ≥ 10      | Engagement present; no strong code-change proof    |
   * | low     | ≥ 8       | Lacks engagement or outcome signals                |
   * | skip    | < 8       | Do not extract a learning                          |
   */
  final_weight?: number;
  /** Labels that increased the signal value (e.g. `addressed_change`, `author_acknowledgement`). */
  boosts: string[];
  /** Labels that decreased the signal value (e.g. `nit_label`, `outdated_thread`). */
  penalties: string[];
}

/** An extracted engineering insight derived from one or more evidence records. */
export interface LearningRecord extends CanonicalRecord {
  type: 'learning';
  repository_id: string;
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
  evidence_ids: string[];
  tags: string[];
}

/** The full in-memory view of all canonical JSONL data for one repo. */
export interface LearningsDataset {
  repositories: RepositoryRecord[];
  evidence: EvidenceRecord[];
  learnings: LearningRecord[];
}
