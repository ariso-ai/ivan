# Learnings DB Schema Proposal

## Purpose

This is the clean-room launch schema for `learnings.db`.

It assumes:

- one committed repo-local SQLite database at repo root
- `repository_id` exists from day one
- prompt-time retrieval reads local knowledge only
- runtime jobs/orchestration stay in memory
- learning extraction is primarily from:
  - GitHub PR evidence
  - prior Claude Code / Codex session outputs

This proposal intentionally does **not** include:

- tombstones
- persisted jobs
- audit tables
- persisted query history
- persisted capability proposals

## Design Principles

- Keep the raw input unit as `evidence`, not `artifact`
- Keep `learnings` as distilled reusable statements
- Preserve traceability from learning back to source evidence
- Make retrieval/indexing data rebuildable where possible
- Add `repository_id` now, even if the first deployment is repo-local

## Core Tables

### 1. `repositories`

Purpose:
Identify the repository scope for all stored knowledge.

Suggested fields:

- `id` INTEGER PRIMARY KEY
- `slug` TEXT NOT NULL UNIQUE
- `name` TEXT NOT NULL
- `local_path` TEXT
- `remote_url` TEXT
- `is_active` INTEGER NOT NULL DEFAULT 1
- `created_at` TEXT NOT NULL
- `updated_at` TEXT NOT NULL

Notes:

- `slug` should be stable and human-readable.
- `local_path` and `remote_url` are optional but useful for ingestion and debugging.

### 2. `evidence`

Purpose:
Store raw or lightly normalized source material from which learnings are extracted.

Examples:

- human PR review comment
- human PR conversation comment
- review summary
- PR body
- Claude/Codex session-derived note

Suggested fields:

- `id` INTEGER PRIMARY KEY
- `repository_id` INTEGER NOT NULL
- `source_system` TEXT NOT NULL
- `source_type` TEXT NOT NULL
- `external_id` TEXT
- `parent_external_id` TEXT
- `author_type` TEXT
- `author_name` TEXT
- `title` TEXT
- `content` TEXT NOT NULL
- `summary` TEXT
- `url` TEXT
- `pr_number` INTEGER
- `file_path` TEXT
- `line_start` INTEGER
- `line_end` INTEGER
- `review_state` TEXT
- `resolution_state` TEXT
- `occurred_at` TEXT
- `created_at` TEXT NOT NULL
- `updated_at` TEXT NOT NULL

Foreign keys:

- `repository_id` -> `repositories.id`

Notes:

- `source_system` examples: `github`, `claude_code`, `codex`
- `source_type` examples: `pr_review_comment`, `pr_comment`, `pr_review_summary`, `pr_body`, `session_note`
- `parent_external_id` supports threads/replies without modeling a full comment graph yet.
- `summary` is optional normalized text if later ingestion wants a lightweight distilled version alongside raw content.

### 3. `learnings`

Purpose:
Store distilled reusable lessons derived from evidence.

Suggested fields:

- `id` INTEGER PRIMARY KEY
- `repository_id` INTEGER NOT NULL
- `kind` TEXT NOT NULL
- `title` TEXT
- `statement` TEXT NOT NULL
- `rationale` TEXT
- `applicability` TEXT
- `confidence` REAL
- `status` TEXT NOT NULL DEFAULT 'active'
- `created_at` TEXT NOT NULL
- `updated_at` TEXT NOT NULL

Foreign keys:

- `repository_id` -> `repositories.id`

Notes:

- `kind` examples:
  - `engineering_lesson`
  - `repo_convention`
  - `review_heuristic`
  - `agent_workflow_pattern`
- `statement` is the retrieval-first field. It should stand alone when injected into prompt context.
- `status` can stay simple at launch: `active`, `suppressed`, `draft`.

### 4. `learning_evidence`

Purpose:
Link learnings back to the evidence that supports them.

Suggested fields:

- `learning_id` INTEGER NOT NULL
- `evidence_id` INTEGER NOT NULL
- `relationship_type` TEXT NOT NULL DEFAULT 'supports'
- `weight` REAL
- `note` TEXT
- `created_at` TEXT NOT NULL

Primary key:

- (`learning_id`, `evidence_id`)

Foreign keys:

- `learning_id` -> `learnings.id`
- `evidence_id` -> `evidence.id`

Notes:

- This table is the core anti-handwaving mechanism.
- It allows later weighting without forcing that policy into the `learnings` table itself.

### 5. `learning_tags`

Purpose:
Support retrieval filtering and lightweight classification.

Suggested fields:

- `learning_id` INTEGER NOT NULL
- `tag` TEXT NOT NULL
- `source` TEXT NOT NULL DEFAULT 'inferred'
- `weight` REAL
- `created_at` TEXT NOT NULL

Primary key:

- (`learning_id`, `tag`)

Foreign keys:

- `learning_id` -> `learnings.id`

Notes:

- `source` examples: `inferred`, `manual`, `imported`
- Keep tags flat at launch. No tag ontology yet.

## Derived / Rebuildable Indexes

These are part of the DB design, but they are not primary business entities.

### 6. `evidence_fts`

Purpose:
Full-text search over evidence content.

Indexed fields:

- `title`
- `content`
- `summary`

### 7. `learnings_fts`

Purpose:
Full-text search over learning text.

Indexed fields:

- `title`
- `statement`
- `rationale`
- `applicability`

### 8. `learning_embeddings`

Purpose:
Vector search support for learnings.

Suggested fields:

- vector column / virtual table row
- `learning_id`
- optional normalized text used for embedding
- optional model identifier

Notes:

- This can be implemented with `sqlite-vec`.
- Embed the retrieval text, not raw evidence.
- If model/version tracking is not needed on day one, it can be added later.

## Minimal Invariants

- Every `evidence` row belongs to one repository.
- Every `learning` row belongs to one repository.
- Every learning should link to at least one supporting evidence row.
- `statement` in `learnings` must be non-empty.
- `source_system` + `source_type` should be from a controlled vocabulary, even if enforced in application code first.
- Prompt-time retrieval should default to `learnings`, not `evidence`.

## Controlled Vocabulary Suggestions

### `evidence.source_system`

- `github`
- `claude_code`
- `codex`
- `manual`

### `evidence.source_type`

- `pr_body`
- `pr_review_summary`
- `pr_review_comment`
- `pr_comment`
- `session_note`
- `session_summary`

### `learnings.kind`

- `engineering_lesson`
- `repo_convention`
- `review_heuristic`
- `workflow_pattern`

## Retrieval Model

Default prompt-time retrieval path:

1. Query `learnings`
2. Rank by lexical and/or vector relevance
3. Optionally filter by tags
4. Inject the top small set into Claude Code context

Evidence lookup path:

1. Use `learning_evidence` to inspect support for a recalled learning
2. Pull the highest-weight supporting evidence when explanation or provenance is needed

This keeps prompt injection concise while preserving explainability.

## What To Defer

Defer these until real usage proves the need:

- thread graph tables for PR discussions
- separate tables for review threads vs comments vs replies
- tombstones / delete propagation model
- persisted jobs and schedulers
- audit/event ledger
- query history
- proposal/publishing workflow persistence
- complex dedupe tables
- cross-repo federation features

## Recommended First-Pass SQLite Shape

If implementing this immediately, I would start with:

- `repositories`
- `evidence`
- `learnings`
- `learning_evidence`
- `learning_tags`
- `evidence_fts`
- `learnings_fts`
- `learning_embeddings`

That is enough to support:

- ingesting PR and session evidence
- extracting learnings
- tracing a learning back to evidence
- prompt-time recall
- basic tag filtering

## Open Questions

- Whether `evidence.summary` is needed at launch or can be derived later
- Whether `confidence` should be normalized to a float or a small enum first
- Whether `learning_embeddings` needs model/version fields on day one
- How aggressively to dedupe nearly-identical learnings at ingest time
