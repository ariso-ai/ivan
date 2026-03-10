# Plan: Learnings Storage MVP (Option C)

## Goal

Implement the first shippable learnings subsystem for Ivan using the March 9, 2026 storage decision:

- canonical records live as committed text files under a target repository's `learnings/` tree
- `<target-repo>/learnings.db` is a deterministic derived read model
- prompt-time and query-time retrieval use only local derived knowledge, never live GitHub

This plan maps that storage model onto the current Ivan CLI codebase without disturbing the existing control-plane database at `~/.ivan/db.sqlite`.

## Technical Choices

- **Canonical store**: Target-repo `learnings/` tree using repository YAML plus Markdown-with-frontmatter evidence and learning records.
  - Rationale: matches the Option C research and keeps reviews/merges on text instead of SQLite binaries.
- **Derived DB location**: `<target-repo>/learnings.db`, separate from Ivan's existing `~/.ivan/db.sqlite`.
  - Rationale: preserves repo-native compounding while keeping Ivan's jobs/tasks DB unchanged.
- **Subsystem boundary**: New `src/learnings/` module for record parsing, validation, building, ingestion, extraction, and querying.
  - Rationale: this is a new product surface, not a small extension of jobs/tasks tables.
- **CLI boundary**: New `ivan learnings ...` command family with explicit verbs instead of passive background writes.
  - Rationale: the handoff explicitly called out the need to decide the builder shape and exact CLI boundary.
- **Workflow scope**: Keep slice 1 workflow-native inside Ivan's CLI/query surfaces; treat public dashboards or hosted proof surfaces as downstream consumers, not launch scope.
  - Rationale: the product-comparables prompt explicitly warns against dashboard-first scope creep, while the Ari/Ivan dashboard spec is a later consumer of Ivan/GitHub data rather than the learnings MVP itself.
- **GitHub ingestion model**: Introduce a richer learnings-specific PR evidence model instead of widening the existing thin `PRComment` shape everywhere.
  - Rationale: current PR services are optimized for "address unresolved comments," not durable evidence extraction.
- **Evidence-source focus**: Launch with GitHub PR evidence first; defer Claude/Codex session-derived evidence even though the broader product framing includes it.
  - Rationale: PR evidence already has concrete March 9 research, clear weighting guidance, and partial service hooks in the current codebase.
- **Vector indexing**: Treat embeddings as optional in slice 1; ship the FTS-backed builder first and add `sqlite-vec` only once runtime loading is proven.
  - Rationale: the schema proposal includes `learning_embeddings`, but the current repo has no extension-loading path yet.
- **Testing strategy**: Add a real test harness and fixture-based tests before shipping parser/builder/weighting logic.
  - Rationale: the current repository has `build`, `typecheck`, and `lint`, but no working tests.

## Current State Analysis

Ivan already has several reusable foundations:

- Command registration is centralized in [`src/index.ts`](src/index.ts), with DB-backed workflows explicitly calling migrations before work.
- PR #15 already established the current hybrid routing pattern around `program.parseOptions(args)` plus `operands`, which is the path new `ivan learnings ...` commands must extend rather than bypass.
- SQLite persistence already exists via `better-sqlite3` + Kysely in [`src/database.ts`](src/database.ts) and [`src/database/migration.ts`](src/database/migration.ts).
- Repository scoping is already modeled and persisted through [`src/services/repository-manager-cli.ts`](src/services/repository-manager-cli.ts) and [`src/services/repository-manager-pat.ts`](src/services/repository-manager-pat.ts).
- GitHub PR access already exists in both CLI and PAT modes through [`src/services/pr-service-cli.ts`](src/services/pr-service-cli.ts), [`src/services/pr-service-pat.ts`](src/services/pr-service-pat.ts), and [`src/services/github-api-client.ts`](src/services/github-api-client.ts).
- PR #16's auto-address loop, repo-instructions onboarding, per-branch worktree grouping, and formatting/tooling changes are now part of the baseline behavior this subsystem must not regress.

The gaps are equally clear:

- The existing persistent model only covers `repositories`, `jobs`, `tasks`, and `migrations` in [`src/database/types.ts`](src/database/types.ts).
- The current PR evidence model is intentionally thin: `PRComment` only exposes `id`, `author`, `body`, `createdAt`, and optional path/line in [`src/services/git-interfaces.ts`](src/services/git-interfaces.ts).
- The current unresolved-comment logic intentionally collapses review-thread detail into a narrow addressing workflow in [`src/services/pr-service-cli.ts`](src/services/pr-service-cli.ts) and [`src/services/pr-service-pat.ts`](src/services/pr-service-pat.ts).
- PAT-mode check fetching is currently broken because `getPRChecks()` expects a head SHA that `getPR()` does not return, so the GitHub expansion work must include a correctness fix rather than only additive evidence fetches.
- No canonical-record store exists today. Ivan persists configuration and its control-plane DB under `~/.ivan` in [`src/config.ts`](src/config.ts).
- PR #15 previously removed `thoughts/shared/plans` and `thoughts/shared/specs` from the branch, so continuity assumptions should remain explicit and branch-local going forward.
- The repository still has no working automated test path: `npm test` is a placeholder, `.github/workflows/test.yml` is a stub, and `tsconfig.json` currently excludes non-`src` test coverage.

### Key Files

- `package.json` - build/test/lint script surface and CLI packaging
- `.github/workflows/ci.yml` - current CI verification surface
- `.github/workflows/test.yml` - placeholder test workflow that must become real
- `tsconfig.json` - current TypeScript scope, which excludes tests today
- `.gitignore` - missing `learnings.db` ignore coverage
- `src/index.ts` - top-level CLI command registration and recognized-command parsing
- `src/config.ts` - `~/.ivan` configuration and control-plane DB bootstrap
- `src/database.ts` - current SQLite/Kysely setup for Ivan's control-plane DB
- `src/database/migration.ts` - migration runner pattern
- `src/database/types.ts` - current durable schema types
- `src/services/git-interfaces.ts` - shared Git/PR service interfaces and thin PR models
- `src/services/service-factory.ts` - auth-mode service selection
- `src/services/repository-manager-cli.ts` - repo registration and `repository.id` allocation
- `src/services/repository-manager-pat.ts` - PAT-mode repo registration equivalent
- `src/services/github-api-client.ts` - REST/GraphQL GitHub access in PAT mode
- `src/services/pr-service-cli.ts` - GitHub CLI-backed PR/comment fetching
- `src/services/pr-service-pat.ts` - PAT-backed PR/comment fetching
- `src/services/task-executor.ts` - main task workflow where `repository.id` is already resolved
- `src/services/address-executor.ts` - PR issue workflow where `repository.id` and `commentId` already exist
- `src/web-server.ts` - example SQLite read-model consumer
- `thoughts/shared/prs/15_description.md` - routing/history context for the current CLI baseline
- `thoughts/shared/prs/16_description.md` - recent workflow changes that define the current baseline
- `thoughts/shared/specs/2026-03-09-ari-ivan-dashboard.md` - downstream consumer context, not launch scope

## Tasks

### Task 1: Define the Learnings Subsystem Boundary

Create the explicit code and CLI boundary for learnings.

- [ ] Add a new `src/learnings/` module namespace for types, parser, builder, ingestion, extraction, and query logic
- [ ] Add a new `ivan learnings` command family in `src/index.ts`
- [ ] Preserve the current `program.parseOptions(args)` + `operands` routing pattern from PR #15 while adding the new command family
- [ ] Update the manual `recognizedCommands` list in `src/index.ts` so new learnings verbs are not mis-routed as task descriptions
- [ ] Decide and document the first command set:
  - `ivan learnings init --repo <path>`
  - `ivan learnings rebuild --repo <path>`
  - `ivan learnings ingest-pr --repo <path> --pr <number>`
  - `ivan learnings query --repo <path> --text "..."`

**Files to modify:**

- `src/index.ts`
- `src/services/service-factory.ts`
- `src/services/git-interfaces.ts`

**Files to add:**

- `src/learnings/index.ts`
- `src/learnings/types.ts`

### Task 2: Implement Canonical Record Models, Parsing, and Validation

Build the canonical text-record layer defined by the schema proposal.

- [ ] Implement repository, evidence, and learning record types matching the proposal
- [ ] Parse Markdown-with-frontmatter evidence and learning records plus repository YAML records
- [ ] Validate core invariants:
  - stable `id`
  - required `repository_id`
  - learning -> evidence linkage
  - non-empty learning statement
- [ ] Decide and document ID generation rules:
  - deterministic external IDs for GitHub-derived evidence
  - stable learning IDs for extracted learnings
- [ ] Add deterministic ordering rules so builder output does not depend on filesystem enumeration

**Files to modify:**

- `package.json`

**Files to add:**

- `src/learnings/record-types.ts`
- `src/learnings/frontmatter.ts`
- `src/learnings/parser.ts`
- `src/learnings/validator.ts`
- `src/learnings/id.ts`

### Task 3: Build the Derived SQLite Projection

Turn canonical records into a rebuildable local read model.

- [ ] Add a learnings-specific schema definition derived from `2026-03-09-learnings-db-derived-schema.sql`
- [ ] Implement a deterministic builder that:
  - loads canonical records
  - validates references
  - rebuilds `<target-repo>/learnings.db` from scratch
  - populates base tables and FTS tables
- [ ] Keep `learning_embeddings` optional in slice 1 unless `sqlite-vec` is available and reliably loadable
- [ ] Add validation or scaffolding for `.gitignore` coverage of `learnings.db` and `learnings.db-*`
- [ ] Define a stable rebuild contract for local and CI use

**Files to modify:**

- `package.json`

**Files to add:**

- `src/learnings/database.ts`
- `src/learnings/schema.sql`
- `src/learnings/builder.ts`
- `src/learnings/rebuild-command.ts`

### Task 4: Expand GitHub PR Evidence Collection

Upgrade the current PR fetchers from an addressing workflow to a learnings-ingestion workflow.

- [ ] Introduce a learnings-specific PR evidence model that captures:
  - PR metadata and body
  - top-level PR conversation comments
  - review summaries with state and body
  - full review threads with thread IDs, resolution, outdatedness, and actor metadata
  - enough commit/patch context to score "addressed change"
- [ ] Fix PAT-mode check fetching by returning or separately fetching the PR head SHA before `getPRChecks()` tries to inspect commit check-runs
- [ ] Extend PAT mode in `src/services/github-api-client.ts` to fetch the missing thread and commit details
- [ ] Extend CLI mode in `src/services/pr-service-cli.ts` with equivalent `gh`/GraphQL calls
- [ ] Keep existing `address` behavior stable by layering new learnings-specific interfaces instead of breaking `PRComment`

**Files to modify:**

- `src/services/git-interfaces.ts`
- `src/services/github-api-client.ts`
- `src/services/pr-service-cli.ts`
- `src/services/pr-service-pat.ts`

**Files to add:**

- `src/learnings/github-evidence.ts`
- `src/learnings/github-ingestion.ts`

### Task 5: Implement Evidence Weighting and Canonical Evidence Writes

Turn raw PR evidence into traceable, weighted canonical evidence records.

- [ ] Implement the hand-tuned weighting policy from the March 9 PR-evidence memo
- [ ] Compute and persist `base_weight`, `final_weight`, `boosts`, `penalties`, and confidence metadata
- [ ] Explicitly classify low-signal cases such as `Nit:`/style-only/bot comments
- [ ] Write canonical evidence records into `learnings/evidence/<repository_id>/`
- [ ] Preserve enough provenance to explain why a record was promoted or ignored

**Files to add:**

- `src/learnings/weighting.ts`
- `src/learnings/evidence-writer.ts`
- `src/learnings/heuristics.ts`

### Task 6: Implement Learning Extraction and Local Query

Create the smallest useful learning loop on top of weighted evidence.

- [ ] Implement rule-based learning extraction using the threshold and generalizability rules from the research memo
- [ ] Differentiate repo-specific conventions from general engineering lessons
- [ ] Write canonical learning records into `learnings/lessons/<repository_id>/`
- [ ] Add a local-only query path over the rebuilt DB that returns learnings plus evidence tracebacks
- [ ] Keep live GitHub calls out of the query path

**Files to add:**

- `src/learnings/extractor.ts`
- `src/learnings/learning-writer.ts`
- `src/learnings/query.ts`
- `src/learnings/query-command.ts`

### Task 7: Verification, Documentation, and Migration Safety

Add the guardrails this repository currently lacks.

- [ ] Add a working automated test setup for parser, builder, weighting, and GitHub-mapper fixtures
- [ ] Add Jest configuration and any TypeScript test config needed so tests can live outside the current `src/**/*` compile scope
- [ ] Add fixture repos and fixture PR payloads for deterministic end-to-end rebuild tests
- [ ] Document target-repo layout, command usage, rebuild expectations, and deferred features
- [ ] Verify current `ivan` and `ivan address` workflows remain unchanged
- [ ] Replace the placeholder `.github/workflows/test.yml` path with a real `npm test` job once the harness exists
- [ ] Add one smoke-test path that:
  - initializes a repo
  - ingests a PR fixture
  - rebuilds the DB
  - queries a derived learning

**Files to modify:**

- `package.json`
- `README.md`

**Files to add:**

- `tests/learnings/parser.test.ts`
- `tests/learnings/builder.test.ts`
- `tests/learnings/weighting.test.ts`
- `tests/learnings/ingestion.test.ts`
- `tests/fixtures/...`
- `jest.config.*` or equivalent

## Success Criteria

### Automated Verification

- [ ] `npm run build`
- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] Deterministic rebuild test: rebuilding the same canonical fixture twice yields the same row counts and content expectations

### Manual Verification

- [ ] `ivan learnings init --repo <path>` creates the expected canonical repository record under the target repo
- [ ] `ivan learnings ingest-pr --repo <path> --pr <number>` writes canonical evidence files for the supported MVP evidence set
- [ ] `ivan learnings rebuild --repo <path>` produces `<target-repo>/learnings.db` without touching Ivan's `~/.ivan/db.sqlite`
- [ ] `ivan learnings query --repo <path> --text "..."` returns only local derived knowledge and linked evidence
- [ ] Existing `ivan` and `ivan address` workflows behave the same before and after the learnings subsystem lands

## Risks (Pre-Mortem)

### Tigers

- **Repo-native canonical records may conflict with Ivan's current `~/.ivan` mental model** (HIGH)
  - Mitigation: introduce an explicit `LearningsWorkspace` abstraction that always takes a target repo root and never falls back to `~/.ivan`.
- **The current GitHub PR abstraction is too thin for weighting and traceability** (HIGH)
  - Mitigation: add new learnings-specific evidence types instead of overloading `PRComment`.
- **PAT mode can silently lag CLI mode if the known `getPRChecks()` head-SHA bug is not fixed inside the GitHub expansion slice** (HIGH)
  - Mitigation: fix the bug as part of Task 4 and add fixtures that exercise both CLI and PAT evidence/check paths.
- **`sqlite-vec` runtime integration may fail on user machines** (HIGH)
  - Mitigation: ship FTS-first and keep embeddings optional until extension loading is verified.
- **No existing test harness means parser/builder regressions will be easy to ship** (HIGH)
  - Mitigation: add fixtures and tests before wiring the command surface to real repositories.

### Elephants

- **The broader product framing includes session-derived learnings and downstream dashboard consumers**
  - Note: keep slice 1 tightly focused on GitHub PR evidence plus local query, but design canonical records so later consumers can reuse them without reworking the storage model.
- **The derived schema is leaner than the richer PR evidence model proposed by research**
  - Note: decide early whether to expand the DDL or intentionally drop fields so the builder/ingester contract stays coherent.

## Assumptions to Verify Before Implementation

- Target repositories are GitHub-backed and accessible through the existing `gh` or PAT flows.
- Canonical learnings should live inside the target repository, not inside this Ivan repo and not inside `~/.ivan`.
- It is acceptable for slice 1 to ship FTS-backed retrieval before vector-backed retrieval.
- The MVP can use a rule-based extraction policy before any learned ranker or cross-PR aggregation exists.

## Out of Scope

- Live `UserPromptSubmit` hook integration or Claude/Codex runtime wiring
- Claude/Codex session-derived evidence ingestion, despite being part of the broader product framing
- Cross-repo federation or multi-repo retrieval
- Persisted background jobs, audit events, query history, or capability proposals
- Bot comments as first-class learning evidence
- Learned ranking, deep semantic diffing, or follow-up PR/revert linkage
- The Ari/Ivan public dashboard or any hosted proof surface beyond local repo-native artifacts
