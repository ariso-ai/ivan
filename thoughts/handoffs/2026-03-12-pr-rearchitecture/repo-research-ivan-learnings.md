---
date: 2026-03-12T14:23:47Z
type: repo-research
status: complete
repository: ivan-learnings
focus: Re-architect the learnings PR to match Ivan's existing SQLite and data utility conventions
---

# Repository Research: ivan-learnings

## Overview

Ivan is a TypeScript CLI that already has one established operational SQLite stack for global app state, and this branch adds a second, intentionally separate learnings stack for repo-local derived search data.

The key architectural decision is that these two stores serve different lifecycles:

- `~/.ivan/db.sqlite` is global, user-scoped, and migration-driven.
- `<repo>/learnings.db` is repo-scoped, derived from committed JSONL, and rebuilt from scratch.

## Architecture & Structure

### Project Organization

- `src/database.ts` creates the global Ivan database at `~/.ivan/db.sqlite` and exposes `DatabaseManager` for jobs/tasks/repositories state.
- `src/database/migration.ts` runs numbered migrations from `src/database/migrations/index.ts`.
- `src/learnings/index.ts` registers the new `ivan learnings ...` CLI surface.
- `src/learnings/database.ts` owns the learnings SQLite file lifecycle.
- `src/learnings/builder.ts` validates canonical JSONL and rebuilds `learnings.db`.
- `src/learnings/query.ts` reads the derived DB in readonly mode for retrieval.

### Technology Stack

- Language: TypeScript + ESM
- CLI: Commander
- Global DB layer: `better-sqlite3` + Kysely
- Learnings DB layer: direct `better-sqlite3`
- Testing: Jest (`tests/learnings.test.mjs`)
- CI: format, lint, typecheck, build, test via GitHub Actions

### Key Files

- `src/database.ts` - global database entry point, hardcoded to `~/.ivan/db.sqlite`
- `src/database/migration.ts` - migration runner for the global DB
- `src/database/migrations/*.ts` - linear numbered migration files
- `src/learnings/database.ts` - repo-local DB lifecycle helpers
- `src/learnings/builder.ts` - full rebuild pipeline from canonical JSONL
- `src/learnings/query.ts` - query path over the derived DB
- `README.md` - documents learnings as canonical JSONL plus derived `learnings.db`
- `docs/how-to-rebuild-the-database.md` - explicitly describes full rebuild semantics
- `pr-14-diff.txt` - archived earlier attempt that put learnings tables into the global DB

## Conventions & Patterns

### Existing Global SQLite Pattern

Observed in `src/database.ts:15-30` and `src/database/migration.ts:13-105`:

- Global DB path is fixed to `~/.ivan/db.sqlite`.
- Kysely wraps `better-sqlite3`.
- Migrations are raw SQL strings, applied in numeric order, and tracked in a `migrations` table.
- This DB is used for Ivan runtime state: jobs, tasks, repositories.

### Migration Conventions

Observed in `src/database/migrations/index.ts` and `src/database/migrations/014_add_original_description_column.ts:3-7`:

- Migrations are registered manually in a central array.
- Files are numbered and additive.
- Recent project convention is moving away from destructive rollback logic.
- The latest migration includes the comment: "No down migration — we never roll back schema changes."

### Existing Learnings Data Pattern

Observed in `src/learnings/database.ts:10-61`, `src/learnings/builder.ts:32-57`, `src/learnings/index.ts:15-66`, `README.md:257-263`, and `docs/how-to-rebuild-the-database.md:3-29`:

- Canonical source of truth is committed JSONL under `learnings/`.
- `learnings.db` is explicitly a derived artifact, not the primary store.
- Rebuild is full-replace, not incremental migration.
- Query code opens the DB readonly after rebuild.
- Learnings CLI commands operate on an arbitrary repo path, not the user-global Ivan config dir.

### Utility Reuse Already Present In This Branch

The learnings slice already has dedicated reusable utilities:

- `src/learnings/database.ts` for DB lifecycle
- `src/learnings/parser.ts` for JSONL loading
- `src/learnings/validator.ts` for dataset validation
- `src/learnings/builder.ts` for atomic rebuild
- `src/learnings/query.ts` for search
- `src/learnings/embeddings.ts` for vector serialization and scoring

This means the branch already avoids ad hoc SQLite access in most places. The main reuse opportunity is to keep code flowing through these utilities consistently, not to bypass them.

## Current PR vs Repository Conventions

### What The Current Branch Actually Does

Against `origin/main`, `ivan-learnings` adds a large repo-local learnings subsystem:

- `ivan learnings init`
- `ivan learnings ingest-pr`
- `ivan learnings extract`
- `ivan learnings rebuild`
- `ivan learnings query`
- hook install support
- tests and docs for the derived DB flow

This branch does not extend the global Ivan DB schema with learnings tables. The `src/database/*` diffs are incidental cleanup and typing changes around the existing runtime DB.

### What The Archived Older Approach Did

`pr-14-diff.txt` shows an older design that:

- added `learnings` and `learning_embeddings` tables to the global `~/.ivan/db.sqlite`
- extended `DatabaseManager` with vector insert/search helpers
- treated learnings as app-global mutable rows instead of repo-local derived data
- used `sqlite-vec` inside the main DB path

That older design is now architecturally out of sync with this branch's documented behavior.

## Key Insights

### Most Important Architectural Boundary

The repo already has two clearly different persistence models:

1. Global operational state:
   `src/database.ts:15-18` stores to `~/.ivan/db.sqlite`.
2. Repo-local learnings retrieval state:
   `src/learnings/database.ts:17-18` stores to `<repo>/learnings.db`.

Using the global migration system for learnings would blur those lifecycles and break the current repo-local design.

### Why Reusing `DatabaseManager` Directly Would Be A Mismatch

- `DatabaseManager` is hard-wired to the user home directory, not the target repo.
- The learnings slice is documented as rebuildable from committed JSONL, so incremental migrations are not the main mechanism.
- Querying learnings is intentionally offline and repo-scoped.
- The branch already has better-scoped learnings utilities than the global DB layer provides.

### Repository-Level Inconsistency To Watch

The docs say `learnings.db` is a derived artifact that should be rebuildable, but this branch currently includes a top-level tracked `learnings.db` file and `.gitignore` does not ignore it. That is inconsistent with `README.md:257-257` and `docs/how-to-rebuild-the-database.md:3-11`.

## Recommendations

### Recommended Re-Architecture

If the goal is "use the existing Ivan sqlite database migration and other data utils," the safest interpretation is:

1. Keep the existing global migration framework for `~/.ivan/db.sqlite` only.
2. Keep learnings repo-local and derived.
3. Reuse the existing learnings utilities (`database.ts`, `builder.ts`, `parser.ts`, `validator.ts`, `query.ts`) instead of introducing a third persistence pattern or reviving `pr-14`'s global learnings tables.

### Concrete Guidance For The PR

- Do not add learnings tables to `src/database/types.ts` or `src/database/migrations/*` unless the feature is truly global Ivan runtime state.
- Do not put repo-specific learnings into `~/.ivan/db.sqlite`.
- Route learnings writes through canonical JSONL writers plus `rebuildLearningsDatabase(...)`.
- Route learnings reads through `openLearningsDatabase(...)` and `queryLearnings(...)`.
- If schema evolution is needed for `learnings.db`, prefer updating `src/learnings/schema.sql` and rebuilding, because the store is explicitly disposable.

### If Migration Semantics Are Still Required

If you need migration-like evolution for learnings despite the rebuild model, create a learnings-specific migration layer under `src/learnings/` and keep the DB path repo-local. Do not piggyback on `DatabaseManager`, because its pathing and responsibility are wrong for this slice.

## Before Contributing

1. Decide whether the target state is the current `ivan-learnings` architecture or the archived `pr-14` architecture.
2. If targeting `ivan-learnings`, treat `pr-14-diff.txt` as historical context only, not the implementation model.
3. Verify any code change preserves the documented invariant: canonical JSONL in git, derived `learnings.db` rebuilt locally.
4. Add or update tests around rebuild/query behavior rather than around mutable global DB state.

## Patterns To Follow

- Use global migrations for operational Ivan state only: `src/database.ts:15-30`
- Use repo-local DB lifecycle helpers for learnings: `src/learnings/database.ts:21-61`
- Use full rebuild after canonical record changes: `src/learnings/builder.ts:36-57`
- Register CLI surface centrally through `registerLearningsCommands`: `src/learnings/index.ts:16-66`

## Sources

- `README.md`
- `CLAUDE.md`
- `.github/workflows/ci.yml`
- `.github/workflows/test.yml`
- `src/database.ts`
- `src/database/migration.ts`
- `src/database/migrations/index.ts`
- `src/database/migrations/014_add_original_description_column.ts`
- `src/learnings/database.ts`
- `src/learnings/builder.ts`
- `src/learnings/index.ts`
- `src/learnings/query.ts`
- `docs/how-to-rebuild-the-database.md`
- `pr-14-diff.txt`
