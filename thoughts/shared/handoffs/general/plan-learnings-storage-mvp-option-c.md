---
date: 2026-03-09T18:11:45Z
type: plan
status: complete
plan_file: thoughts/shared/plans/PLAN-learnings-storage-mvp-option-c.md
---

# Plan Handoff: Learnings Storage MVP (Option C)

## Summary

Created a branch-local implementation plan for the learnings storage MVP. The plan keeps canonical learnings as repo-committed text under a target repository's `learnings/` tree, projects a deterministic `<target-repo>/learnings.db`, and maps the March 9 PR-evidence research onto the existing Ivan CLI/SQLite/GitHub service patterns.

## Plan Created

`thoughts/shared/plans/PLAN-learnings-storage-mvp-option-c.md`

## Key Technical Decisions

- Canonical learnings live in the target repo, not in Ivan's `~/.ivan/db.sqlite`
- Ivan's existing `~/.ivan/db.sqlite` remains the control-plane database for jobs/tasks/config-related workflows
- The learnings system gets its own `src/learnings/` module and `ivan learnings ...` CLI surface
- GitHub evidence ingestion uses richer learnings-specific types instead of reusing the narrow `PRComment` addressing model
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
- Current GitHub review-thread handling is intentionally narrow and does not preserve enough detail for learning extraction
- The PR-evidence memo supports a launch policy centered on human review discourse, acknowledgement, and addressed code-change signals
- `sqlite-vec` is the main unresolved runtime dependency if vector retrieval is included in slice 1

## Assumptions Made

- The intended product behavior is repo-native for target repositories, even though Ivan itself stores its operational DB under `~/.ivan`
- Adding a new command family to `src/index.ts` is acceptable even though command registration is currently monolithic
- Slice 1 may ship with FTS retrieval first and embeddings gated behind a later validation step

## For Next Steps

- Review the plan at `thoughts/shared/plans/PLAN-learnings-storage-mvp-option-c.md`
- Implement from this plan in task order, starting with the `src/learnings/` boundary and `ivan learnings` command surface
- Preserve continuity in this branch's `thoughts/` tree rather than relying on the sibling checkout's planning artifacts
