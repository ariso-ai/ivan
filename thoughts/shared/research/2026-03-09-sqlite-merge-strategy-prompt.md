# Research Prompt: Committed SQLite Knowledge Store and Merge Strategy

## Goal

Research whether a committed repo-local SQLite database is a practical source of truth for a team-shared learning system, and if so, what merge/conflict strategy is simplest and safest for an early-stage startup.

The current product assumption is:

- one SQLite DB at repo root named `learnings.db`
- the DB is committed to git
- the DB compounds team knowledge inside the same repo where work happens
- the product is pre-revenue and should strongly prefer simplicity over cleverness

The specific open concern is branch and PR conflict management.

## Questions To Answer

1. Is committing a live SQLite DB to git a practical approach for a small engineering team?
2. What happens in real workflows when multiple branches modify the DB?
3. What merge strategies are actually viable?
4. Is “SQL as CRDT” or SQLite-based CRDT a realistic near-term choice, or an attractive distraction?
5. What simpler alternatives preserve the product value with much lower operational risk?
6. If we keep the committed DB, what rules, tooling, and constraints are required?

## Evaluate These Options

Evaluate each option directly.

### A. Committed SQLite DB with conventional git workflow

- plain binary DB in repo
- standard branching and merges
- maybe custom merge driver

### B. Committed SQLite DB with a one-writer policy

- only one branch or bot writes the DB
- other branches treat it as read-only
- updates land via main-branch sync or dedicated command

### C. Derived SQLite DB from merge-friendly source files

- canonical source is JSONL / Markdown / YAML / SQL change log
- `learnings.db` is rebuilt locally or in CI
- DB may be committed or uncommitted depending tradeoffs

### D. SQLite changesets / sessions / append-only operation log

- use operation-based merge rather than file merge
- replay inserts/updates into canonical DB

### E. SQLite CRDT approaches

- cr-sqlite or similar
- last-write-wins row merge
- custom SQL-merge approach

### F. Do not commit the DB

- local DB only
- share via another export/import or sync flow

## Decision Criteria

Rank options on:

- simplicity
- branch ergonomics
- reliability
- debuggability
- developer surprise
- setup burden
- CI friendliness
- future scalability
- compatibility with repo-native compounding

## Important Constraints

- This is a pre-customer startup, so operational cleverness is a liability unless it creates immediate product leverage
- The team is willing to defer sophisticated job systems
- Runtime state can stay in memory for now
- The DB may contain:
  - evidence records
  - distilled learnings
  - retrieval metadata
  - capability proposals
- The system should avoid live GitHub fetches on every prompt

## Strong Hypotheses To Test

Test these explicitly.

1. A committed SQLite DB will create painful merge conflicts faster than expected.
2. A one-writer policy may preserve the repo-native feel while avoiding most complexity.
3. A derived DB from append-only text sources may be a better long-term architecture than merging SQLite binaries.
4. SQLite-CRDT approaches are likely too complex for the current stage.
5. The product value comes from retrieval quality and workflow fit, not from making the DB itself magically mergeable.

## Deliverable Format

Produce a memo with:

### 1. Short Answer

- recommended path
- rejected paths
- why

### 2. Real-World Feasibility

Explain what actually happens when teams commit SQLite DBs and work on branches.

### 3. Option Comparison Table

Include:

- option
- complexity
- merge behavior
- implementation effort
- failure modes
- recommendation

### 4. Practical Recommendation For This Product

Give a phased recommendation:

- now
- next stage
- later if scale demands it

### 5. Implementation Notes

If recommending a committed DB path, specify:

- branch rules
- merge policy
- CI checks
- backup / recovery expectations
- who or what is allowed to write

### 6. Research Appendix

- sources
- dates
- any open uncertainties

## Research Method

- Prefer primary/technical sources:
  - SQLite docs
  - Git docs / merge-driver patterns
  - CR-SQLite or equivalent project docs
  - engineering blog posts with real implementation detail
  - repos or products that actually committed SQLite in git
- Distinguish theoretical possibility from operational practicality
- Report research date explicitly

## Final Decision Question

End with:

“If the goal is to maximize product learning while minimizing infra complexity in the next 2-3 months, what exact storage strategy should we choose now?”
