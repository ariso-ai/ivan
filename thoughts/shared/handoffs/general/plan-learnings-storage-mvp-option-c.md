---
date: 2026-03-09T18:11:45Z
validated_at: 2026-03-09T23:52:16Z
type: plan
status: complete
plan_file: thoughts/shared/plans/PLAN-learnings-storage-mvp-option-c.md
---

# Plan Handoff: Learnings Storage MVP (Option C)

## Summary

Created a branch-local implementation plan for the learnings storage MVP. The plan keeps canonical learnings as repo-committed text under a target repository's `learnings/` tree, projects a deterministic `<target-repo>/learnings.db`, and maps the March 9 PR-evidence research onto the existing Ivan CLI/SQLite/GitHub service patterns.

Validation on March 9, 2026 confirmed the plan still stands after incorporating the full March 9 research set, the previously missed prompt/docs context, and the current Ivan codebase. The resulting plan is more explicit about workflow-native v1 scope, GitHub-PR-first ingestion, and current CLI routing/test/PAT-mode constraints.

## Plan Created

`thoughts/shared/plans/PLAN-learnings-storage-mvp-option-c.md`

## Key Technical Decisions

- Canonical learnings live in the target repo, not in Ivan's `~/.ivan/db.sqlite`
- Ivan's existing `~/.ivan/db.sqlite` remains the control-plane database for jobs/tasks/config-related workflows
- The learnings system gets its own `src/learnings/` module and `ivan learnings ...` CLI surface
- Slice 1 stays workflow-native inside Ivan rather than expanding into dashboard/public-proof delivery
- GitHub evidence ingestion uses richer learnings-specific types instead of reusing the narrow `PRComment` addressing model
- GitHub PR evidence is the first launch source; session-derived Claude/Codex evidence is explicitly deferred
- FTS-backed rebuild ships before `sqlite-vec` is treated as required runtime infrastructure

## Task Overview

1. Define the learnings subsystem boundary and CLI surface
2. Implement canonical record parsing and validation
3. Build the deterministic derived SQLite projection
4. Expand GitHub PR evidence collection
5. Apply evidence weighting and write canonical evidence records
6. Extract learnings and expose local query
7. Add tests, fixtures, docs, and regression checks

## Research Findings

- The storage decision has already changed from "committed DB is canonical" to Option C text-first canonical records plus derived SQLite
- The existing Ivan repo already has reusable repo registration, Kysely migrations, and GitHub PR fetchers, but no canonical-record projection pipeline
- PR #15 established the current `program.parseOptions(args)` + `operands` routing pattern and explains the earlier `thoughts/` artifact churn
- PR #16 established the current auto-address/worktree/tooling baseline that the learnings work must preserve
- Current GitHub review-thread handling is intentionally narrow and PAT-mode check fetching has a concrete `head.sha` bug that must be fixed during Task 4
- The PR-evidence memo supports a launch policy centered on human review discourse, acknowledgement, and addressed code-change signals
- The broader product framing emphasizes workflow-native recall and explicitly warns against dashboard-first scope creep
- `sqlite-vec` is the main unresolved runtime dependency if vector retrieval is included in slice 1

## Assumptions Made

- The intended product behavior is repo-native for target repositories, even though Ivan itself stores its operational DB under `~/.ivan`
- Adding a new command family to `src/index.ts` is acceptable even though command registration is currently monolithic
- The Ari/Ivan dashboard spec is a downstream consumer of future Ivan/GitHub data, not part of this implementation slice
- Session-derived learnings remain out of scope for this first GitHub-evidence slice
- Slice 1 may ship with FTS retrieval first and embeddings gated behind a later validation step

## For Next Steps

- Review the plan at `thoughts/shared/plans/PLAN-learnings-storage-mvp-option-c.md`
- Implement from this plan in task order, starting with the `src/learnings/` boundary and `ivan learnings` command surface while preserving the current PR #15 routing approach
- Fix the PAT-mode `getPRChecks()` head-SHA path inside the GitHub evidence slice rather than treating it as a separate follow-up
- Add the real test harness and test workflow wiring before trusting parser/builder/evidence extraction changes
