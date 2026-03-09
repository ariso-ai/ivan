# Committed SQLite Knowledge Store and Merge Strategy

Research date: March 9, 2026 (America/New_York)

## Short Answer

A repo-committed, “live” SQLite database as the source of truth is usually not a practical choice once more than one branch can write to it, because Git cannot semantically merge arbitrary binary SQLite file edits and SQLite’s on-disk representation can change in ways that amplify diffs (including WAL/journal side-files and page reorganization).

The storage strategy that best fits an early-stage startup bias toward simplicity is:

Choose Option C now: make the canonical “knowledge” merge-friendly (append-only text records such as JSONL/NDJSON or Markdown+frontmatter in a `learnings/` directory). Build `learnings.db` deterministically from that source as a derived artifact (usually uncommitted). This keeps the repo-native compounding feel while making PR review/merge safe and unsurprising.

If you insist on keeping `learnings.db` committed right now, the least risky committed-DB approach is Option B (one-writer) with strict enforcement (CI rejects PRs that modify the DB; a single bot or main-branch-only command updates it). This is workable but explicitly “policy-driven,” not “Git magically merges databases.”

Rejected paths (for the next 2–3 months):

- Option A (committed SQLite with normal branching/merges): high probability of frequent conflicts and/or silent loss of edits because binary merges reduce to “pick one side.”
- Option D (SQLite sessions/changesets/op logs) as the primary merge mechanism: technically viable, but it introduces replication-style conflict handling, PRIMARY KEY constraints, and “doesn’t capture everything” limitations that are easy to underestimate.
- Option E (SQLite CRDT, e.g., cr-sqlite): attractive for “no conflicts” marketing, but it adds real distributed-systems complexity and conflict semantics that can be surprising for knowledge content; it also imposes strong constraints on how writes happen.
- Option F (don’t commit DB, but also no canonical merge-friendly source): avoids Git conflicts but undermines repo-native compounding unless paired with a real sharing mechanism; it becomes “everyone has their own local state.”

Explicit hypothesis checks:

- H1 (painful conflicts fast): supported. Git’s documented behavior for non-text (binary) merges is effectively “take one side and leave it conflicted,” and real-world reports of tracking SQLite DBs in Git commonly cite recurring conflicts.
- H2 (one-writer helps): supported, with caveats. Locking + CI enforcement can eliminate most merge pain, but it turns updates into a controlled pipeline.
- H3 (derived DB from text is better architecture): strongly supported. Git is optimized for line-based merges/diffs; tools like sqlite-diffable exist specifically to make SQLite content diffable by converting it to NDJSON-style artifacts.
- H4 (SQLite CRDT too complex now): supported. CRDT layers introduce new rules (how conflicts resolve, how schema is upgraded, and “all writes must go through the system/extension”).
- H5 (value is retrieval/workflow, not magical merge): plausible and consistent with evidence. The simplest path that preserves workflow fit is to keep the repo-native knowledge reviewable and mergeable while treating the DB as an implementation detail.

## Real-World Feasibility

SQLite is explicitly designed to work well as a single-file “document” and is frequently used that way in applications: the “main database file” usually contains the complete state and is easy to copy/move. This is why “commit the file” sounds plausible.

The practical break happens when you combine that file-based database with a Git branching model:

Git can’t meaningfully three-way merge arbitrary SQLite binaries. Git’s own documentation describes that for files without well-defined merge semantics, the “binary” behavior keeps the current-branch version and marks the path conflicted. There is no automatic reconciliation of two independent binary edits.

Teams sometimes mitigate reviewability by configuring textconv diffs (dumping a database as SQL during `git diff`), which helps humans see what changed, but it does not make merges safe, because the diff is explicitly one-way and not suitable to apply as a patch.

Real-world “how do I track a SQLite file in Git?” threads overwhelmingly converge on: you will hit conflicts and end up choosing one version, or adopting an export/dump approach rather than committing the live DB as the merge target.

What actually happens when two branches modify `learnings.db`:

- Both branches commit a different binary. Even if each branch only “adds a row,” SQLite is updating B-tree pages, freelists, and related structures inside the file format; those page-level changes are not aligned to Git’s merge model.
- Merge time: if Git sees both branches touched the same path, it cannot combine the changes. You get a binary conflict and must choose a whole-file winner (`ours` or `theirs`) or do an out-of-band reconstruction.
- If you try “clever merges”: you can write custom merge drivers, but Git emphasizes that merge drivers are external commands expected to produce a single merged result, and they are configured via Git config (not purely via `.gitattributes`), which increases setup burden and cross-machine drift risk.
- SQLite journaling makes “commit the one file” a foot-gun in some modes. In WAL mode, commits are appended to a separate WAL file; that WAL can contain committed state not yet checkpointed back into the main DB file. SQLite’s file format docs treat WAL/journal files as part of the database state during recovery scenarios, and WAL documentation describes commit happening via records appended to the WAL.
- Even outside WAL, SQLite can reorganize storage. For example, `VACUUM` reconstructs the database from scratch, which can rewrite the entire file and create enormous diffs even when logical content is similar. Additionally, SQLite may “defragment” B-tree pages by reorganizing cells on a page, which can amplify binary churn.

Bottom line: committing a live SQLite DB is feasible for single-writer or rarely-changing artifacts, but using it as a multi-branch, frequently-updated shared knowledge store in Git will predictably create merge bottlenecks unless you constrain writes or move the canonical representation to merge-friendly formats.

## Option Comparison Table

| Option | Complexity | Merge behavior | Implementation effort | Failure modes | Recommendation |
| --- | --- | --- | --- | --- | --- |
| A. Committed SQLite DB with conventional Git workflow | Low up-front, high ongoing | Binary conflicts; at best “pick one side,” not a semantic merge | Low until it hurts, then escalates into custom tooling | Lost updates; frequent conflicts; repo churn; WAL/journal state surprises | Do not use as source of truth |
| B. Committed SQLite DB with one-writer policy | Moderate (policy + enforcement) | Mostly no conflicts if enforced; merges become trivial because only main writes | Moderate: CI rules + update command or bot; optional locking | Silent discard if someone edits anyway; bottleneck on writer; broken state if WAL not handled | Viable only if you insist on committing DB now |
| C. Derived SQLite DB from merge-friendly source files | Moderate, stable | Merge is on text records; DB is rebuilt deterministically | Moderate: define canonical schema (JSONL/MD/YAML) + builder + validation | Drift if builder non-deterministic; duplicate IDs; inconsistent references | Best overall for early stage |
| D. SQLite changesets / sessions / append-only op log | High | Operation-based merge possible, but conflict resolution becomes an explicit subsystem | High: enable/ship session extension; enforce PKs; design conflict strategy | Doesn’t capture virtual tables; ignores PK rows with NULL; schema changes not captured; rebase APIs marked experimental | Consider later only if it buys clear leverage |
| E. SQLite CRDT approaches | High to very high | “Always merges,” but conflict semantics shift to CRDT rules (often LWW-style) | High: integrate extension, CRDT schema upgrades, syncing strategy | Surprising outcomes for text-like knowledge; must ensure all writes go through the CRDT system; perf/overhead | Attractive distraction for this stage |
| F. Do not commit the DB | Low | No DB merges at all | Low to moderate depending on sharing method | Knowledge diverges per developer unless you add another canonical sharing path | Not sufficient alone; works paired with C |

## Practical Recommendation For This Product

Now (next 2–3 months): choose Option C with an uncommitted derived DB (C + “don’t commit the artifact”).

Concretely: commit merge-friendly knowledge records; rebuild `learnings.db` locally (and in CI for validation) from those records. This directly addresses the open concern, branch/PR conflict management, by moving merges to Git’s strengths (line-based text merges) and keeping SQLite as a query/runtime optimization rather than a merge target.

A practical “repo-native compounding” layout that minimizes merge collisions is either:

- one file per record (best ergonomics), or
- append-only JSONL with stable IDs and “no in-place edits” conventions (still workable, slightly higher conflict risk if two people append in the same region).

Git’s merge model is line-oriented; structuring the canonical source to minimize overlapping edits is the main lever.

To preserve the product’s value (“avoid live remote fetches on every prompt”), you can keep all evidence references, distilled learnings, and retrieval metadata in these repo-committed records and only compute embeddings/indexes locally or in CI as needed; SQLite’s role becomes a cached, fast retrieval index over committed text inputs, not the canonical storage layer.

Next stage (when you need convenience for non-build users or want a single “known-good” snapshot): add a controlled snapshot pipeline (Option B layered on C).

Example: main branch owns the snapshot, produced by a single command or bot after merges. If you use file locking, Git LFS locking is explicitly intended to discourage parallel edits of unmergeable files and can block pushes that modify locked paths.

Later (only if collaboration demands converge-on-merge semantics across many writers/devices): re-evaluate D or E.

SQLite’s session/changeset tooling can encode row-level changesets and merge them, but it imposes constraints (PRIMARY KEY requirements; no virtual table capture; schema-change gaps) and pushes you into explicit conflict-resolution design.

CRDT layers like cr-sqlite provide “merge without conflicts” in a distributed-systems sense, but they still resolve conflicts via deterministic rules (often last-write-wins-like per column) and require strict control over how writes occur. This is rarely the simplest path for a team-shared internal knowledge store.

Exact storage strategy to choose now: canonical knowledge in repo-committed text records (JSONL/Markdown) + deterministic builder that generates `learnings.db` locally/CI (not committed), with CI validation ensuring the canonical inputs remain consistent and rebuildable.

## Implementation Notes

Recommended baseline (Option C as the source of truth):

- Canonical format: NDJSON/JSONL or Markdown with frontmatter, stored under a `learnings/` directory, ideally one record per file to minimize overlapping edits. This aligns with approaches/tools designed to serialize database-like state into diffable file trees (e.g. NDJSON + metadata).
- Stable identifiers: require a unique ID per record (UUID/ULID-style), so merges are set unions rather than “two people edited the same row.” This is an architectural inference consistent with Git’s line-based merge strengths.
- Deterministic rebuild: ensure the builder produces a stable DB output given the same inputs (consistent ordering of inserts, deterministic schema migrations). Non-determinism defeats debuggability. This is also why Git’s docs warn textconv diffs are for viewing and not applying, so deterministic generation is the safe way to get reproducible artifacts.
- CI checks: validate that all canonical records parse, IDs are unique, references resolve, and a rebuild succeeds from scratch. This makes the repo itself the durable source of truth and keeps the DB cacheable.
- Developer UX: provide a single build-learnings command that regenerates `learnings.db` and any derived indexes. If rebuilds are fast, the “DB is local” becomes an advantage rather than friction.

If you keep a committed DB anyway (Option B or A with heavy constraints), minimum safe rules/tooling:

- Branch rule: PRs must not modify `learnings.db`; only main (or a bot) updates it. This directly avoids binary merge semantics.
- Write permission enforcement: use file locking if available in your hosting workflow. Git LFS locking is documented as a mechanism to lock paths and have pushes verified against locks.
- Explicit SQLite journaling policy: avoid WAL-on-commit surprises. SQLite documents that WAL files hold appended changes and commits occur by appending records to the WAL; the file format docs describe rollback/WAL files as part of database state in recovery scenarios. Operationally, you need a checkpoint/close/then-commit discipline or avoid WAL mode for the committed artifact.
- Prohibit `VACUUM` in the committed artifact workflow (or gate it), because `VACUUM` reconstructs the database from scratch and can cause large diffs unrelated to logical changes.
- Custom merge drivers: treat as last resort. Git’s own docs emphasize that custom merge drivers are external commands configured in Git config; this is extra setup burden and a common source of “works on my machine” drift.
- Recovery expectation: treat the committed DB as a cache you can rebuild, not the only copy. SQLite’s own FAQ points out how difficult recovery can be without backups, and that `VACUUM` can make recovery impossible after deletion. You want the true source in simple committed text, with rebuildability as the safety net.

Why “SQL as CRDT” / SQLite-based CRDT is likely a distraction right now:

- cr-sqlite and similar systems are real and used in production contexts (e.g. Fly.io documents using cr-sqlite in its Corrosion system), but they impose strict invariants: conflict resolution is algorithmic (e.g. per-column version ordering and tie-breakers), and all writes must go through the correct layer or consistency breaks.
- Even when conflicts auto-resolve, knowledge content is often better modeled as “keep both and review,” not “pick a last-write-wins field value.” So CRDT correctness can still be a product surprise. This is a product inference supported by the documented LWW-style behavior and caveats.

## Research Appendix

Primary/technical sources consulted:

- SQLite file state, rollback journal/WAL, and database file format: SQLite database file format docs and WAL docs (including that commits can occur via writing records to WAL; and that rollback/WAL files are part of the database state during recovery scenarios).
- SQLite maintenance behavior that can amplify diffs: SQLite FAQ on `VACUUM` reconstructing a database from scratch; and documentation quoted about B-tree page “defragmenting.”
- Git merge/diff mechanics for binary files and custom drivers: `gitattributes` documentation (binary merge behavior; custom merge driver configuration; definition location in Git config; textconv limitations).
- Git LFS file locking: Git LFS lock documentation describing server-side locking and push verification.
- SQLite sessions/changesets: SQLite session extension intro and API docs, including limitations (PRIMARY KEY requirement; no virtual table capture; experimental rebaser APIs) and changegroup merge semantics.
- SQLite diff tooling: `sqldiff` docs (including that it can output a binary changeset and relies on rowid/primary key pairing semantics).
- “Make SQLite changes reviewable in Git” approaches: sqlite-diffable documentation (dump/load into diffable directory structure using NDJSON) and discussions of configuring Git diffs for SQLite.
- CRDT SQLite: cr-sqlite documentation and Fly.io Corrosion docs describing CRDT-backed tables, conflict resolution rules, and the “writes must go through the system” caveat.

Open uncertainties (worth validating in your specific environment):

- Whether your chosen SQLite client/library defaults to WAL mode in your context, and how consistently it checkpoints on close, because that affects whether “commit only `learnings.db`” ever risks missing committed-but-uncheckpointed state. SQLite’s documentation makes clear that WAL changes live in a separate WAL file and commits occur there; operational defaults vary by wrapper/tooling.
- How much your intended “knowledge writes” look like inserts-only vs. in-place updates/deletes, which significantly impacts how well an append-only text log maps to your retrieval needs. This is an architectural uncertainty, not a missing citation issue.

## Final Decision Question

If the goal is to maximize product learning while minimizing infra complexity in the next 2–3 months, what exact storage strategy should we choose now?
