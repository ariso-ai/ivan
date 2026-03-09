# Learnings Storage Proposal

## Purpose

This is the clean-room launch storage design for the MVP.

It replaces the earlier assumption that `learnings.db` is the canonical store.

The new rule is:

- committed text records under `learnings/` are the source of truth
- `learnings.db` is a derived SQLite read model built from those records
- prompt-time retrieval reads only the local derived DB

This follows the research conclusion that Option C is the right MVP path:

- merge-friendly canonical records
- deterministic local/CI rebuild into SQLite
- no binary database merges in normal branch workflows

## What Is Canonical vs Derived

Canonical:

- repo-committed text records under `learnings/`

Derived:

- `learnings.db`
- FTS indexes
- vector indexes / embeddings

This means:

- Git reviews and merges happen on text files
- SQLite is an implementation detail for fast local retrieval
- the DB can be deleted and rebuilt at any time

## Design Principles

- Keep the raw input unit as `evidence`
- Keep `learnings` as distilled reusable statements
- Preserve traceability from each learning back to supporting evidence
- Add `repository_id` now, even if the first deployment is repo-local
- Keep runtime job/orchestration/query state out of persistence for now

## Source-of-Truth Layout

```text
learnings/
  repositories/
    repo_ivan.yaml
  evidence/
    repo_ivan/
      ev_01JNX9M7M6T0A5KJ4A1B9Z2Q1P.md
      ev_01JNX9N2H7S6R4E8C3D0F5G6H1.md
  lessons/
    repo_ivan/
      lrn_01JNXA4TK7A2X9KQ6R3M1N8P5V.md
      lrn_01JNXA7QF1Z3C8R5B6T2K4M9D0.md
```

## Canonical Record Types

### 1. Repository record

Path:

```text
learnings/repositories/<repository_id>.yaml
```

Example:

```yaml
id: repo_ivan
slug: ivan
name: Ivan
local_path: /Users/michaelgeiger/Developer/repos/ivan
remote_url: git@github.com:ariso-ai/ivan.git
is_active: true
created_at: 2026-03-09T00:00:00Z
updated_at: 2026-03-09T00:00:00Z
```

### 2. Evidence record

Path:

```text
learnings/evidence/<repository_id>/<evidence_id>.md
```

Format:

- YAML frontmatter for structured fields
- Markdown body for the evidence text

Example:

```md
---
id: ev_01JNX9M7M6T0A5KJ4A1B9Z2Q1P
repository_id: repo_ivan
source_system: github
source_type: pr_review_comment
external_id: 1234567890
parent_external_id: 1234567880
url: https://github.com/org/repo/pull/15#discussion_r1234567890
pr_number: 15
review_id: 99887766
thread_id: PRT_kwDO...
comment_id: PRRC_kwDO...
author_type: human
author_name: alice
author_role: reviewer
file_path: src/auth.ts
line_start: 84
line_end: 84
review_state: CHANGES_REQUESTED
resolution_state: resolved
occurred_at: 2026-03-09T12:15:00Z
base_weight: 3
final_weight: 11
boosts:
  - author_acknowledgement
  - addressed_change
penalties: []
created_at: 2026-03-09T12:20:00Z
updated_at: 2026-03-09T12:20:00Z
---
This lock is held across an await. That can deadlock under load.
Prefer copying the data and releasing the lock before the async call.
```

### 3. Learning record

Path:

```text
learnings/lessons/<repository_id>/<learning_id>.md
```

Format:

- YAML frontmatter for identity, classification, and evidence linkage
- Markdown body with small fixed sections

Example:

```md
---
id: lrn_01JNXA4TK7A2X9KQ6R3M1N8P5V
repository_id: repo_ivan
kind: engineering_lesson
status: active
confidence: 0.86
source_type: github_pr_discourse
evidence_ids:
  - ev_01JNX9M7M6T0A5KJ4A1B9Z2Q1P
  - ev_01JNX9N2H7S6R4E8C3D0F5G6H1
tags:
  - concurrency
  - async
  - locking
created_at: 2026-03-09T12:30:00Z
updated_at: 2026-03-09T12:30:00Z
---
## Statement
Avoid holding locks across awaits or other blocking operations.

## Rationale
It increases deadlock risk and makes contention harder to reason about under load.

## Applicability
Use this in async handlers, queue processors, and background jobs that mix shared state and I/O.
```

## Canonical Format Rules

- One record per file
- Stable string IDs from day one
- Repository-scoped paths
- UTF-8 text only
- No in-place mutation requirement at the storage level, but records should remain small and reviewable
- The builder must tolerate record ordering differences and produce the same SQLite output for the same logical inputs

## Why Markdown + Frontmatter

For this product, Markdown + frontmatter is the right first format because:

- it is reviewable in GitHub
- it supports narrative text well
- it is easier for humans to edit than raw JSON
- it still gives a deterministic machine-readable header

If this becomes too loose later, evidence records can move to JSON without changing the overall Option C architecture.

## Builder Contract

The builder is responsible for:

1. reading all repository, evidence, and learning records
2. validating IDs and references
3. materializing a clean `learnings.db`
4. rebuilding FTS and vector indexes
5. failing fast on invalid canonical inputs

The builder should be deterministic:

- same input tree
- same ordering policy
- same SQLite contents

## Derived SQLite Read Model

The SQLite DB exists only to support:

- prompt-time recall
- evidence inspection
- fast lexical search
- fast vector search over learnings

The read model should contain:

- `repositories`
- `evidence`
- `learnings`
- `learning_evidence`
- `learning_tags`
- derived FTS tables
- derived vector table for learnings

## Mapping: Canonical Files -> SQLite

| Canonical source | Derived table |
| --- | --- |
| `learnings/repositories/*.yaml` | `repositories` |
| `learnings/evidence/<repo>/*.md` | `evidence` |
| `learnings/lessons/<repo>/*.md` | `learnings` |
| `evidence_ids` on learning frontmatter | `learning_evidence` |
| `tags` on learning frontmatter | `learning_tags` |

## Minimal Business Entities

### `repositories`

Purpose:
Repository scope and identity.

### `evidence`

Purpose:
Raw or lightly normalized source material.

Examples:

- human PR review comment
- human PR conversation comment
- review summary
- PR body
- Claude/Codex session-derived note

### `learnings`

Purpose:
Distilled reusable statements retrieved during prompt-time recall.

### `learning_evidence`

Purpose:
Proof links from a learning back to the evidence that supports it.

### `learning_tags`

Purpose:
Simple retrieval filters and lightweight classification.

## Minimal Invariants

- Every canonical record must have a stable `id`
- Every evidence record belongs to one repository
- Every learning belongs to one repository
- Every learning links to at least one evidence record
- `statement` must be non-empty
- prompt-time retrieval targets learnings, not raw evidence
- `repository_id` is required from day one

## Controlled Vocabulary Suggestions

### `source_system`

- `github`
- `claude_code`
- `codex`
- `manual`

### `source_type`

- `pr_body`
- `pr_review_summary`
- `pr_review_comment`
- `pr_comment`
- `session_note`
- `session_summary`

### `kind`

- `engineering_lesson`
- `repo_convention`
- `review_heuristic`
- `workflow_pattern`

## What Is Explicitly Deferred

Defer these until real usage proves the need:

- tombstones / delete propagation
- persisted jobs and schedulers
- audit/event tables
- persisted query history
- persisted capability proposals
- thread graph tables beyond lightweight linkage fields
- cross-repo federation logic
- heavyweight semantic diff matching

## Git and Rebuild Rules

Under Option C:

- commit canonical text records
- do not commit `learnings.db`
- add `learnings.db` and `learnings.db-*` to `.gitignore`
- rebuild locally and in CI
- treat rebuild success as a validation step

## Immediate Next Implementation Artifacts

1. actual SQLite DDL for the derived DB
2. parser/validator for canonical records
3. deterministic builder command
4. GitHub PR ingestion mapper into canonical evidence records
5. prompt-time retrieval contract over the derived DB
