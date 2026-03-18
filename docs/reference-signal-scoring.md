# Reference: Signal Scoring and Extraction Context

This document covers two related questions:

1. How evidence weights are computed and what values are actually reachable in production.
2. What context the LLM extraction model can see when deriving a lesson from a piece of evidence.

---

## Part 1 — Weight Call Graph

### Entry point

```
ivan learnings ingest-pr
  src/learnings/ingest-pr-command.ts:21   runIngestPrCommand()
    src/learnings/github-ingestion.ts:28  ingestPullRequestEvidence()
      src/learnings/github-evidence.ts:94    fetchGitHubPullRequestEvidence()
      src/learnings/evidence-writer.ts:29    buildEvidenceRecordsFromPullRequest()
```

### Weight computation per evidence type

```
evidence-writer.ts:29  buildEvidenceRecordsFromPullRequest()
  │
  ├─ PR body           evidence-writer.ts:53   ← HARDCODED, no weight function
  │                      base_weight: 5
  │                      final_weight: 5
  │                      boosts: ['pr_summary']
  │
  ├─ issue comments    evidence-writer.ts:67   weightIssueComment(comment)
  │                    weighting.ts:31         → computeWeight(body, { baseWeight: 3 })
  │                    weighting.ts:139          if isLowSignalReviewText(body): finalWeight -= 2
  │                    POSSIBLE OUTPUTS:
  │                      finalWeight: 3  (substantive text)
  │                      finalWeight: 1  (nit: / style: / typo: prefix)
  │
  ├─ reviews           evidence-writer.ts:98   weightReview(review)
  │                    weighting.ts:46         CHANGES_REQUESTED → baseWeight = 6
  │                    weighting.ts:55         APPROVED / COMMENTED → baseWeight = 2
  │                    weighting.ts:54         → computeWeight(body, { baseWeight })
  │                    weighting.ts:139          if isLowSignalReviewText(body): finalWeight -= 2
  │                    POSSIBLE OUTPUTS:
  │                      finalWeight: 6  (CHANGES_REQUESTED, substantive)
  │                      finalWeight: 4  (CHANGES_REQUESTED, nit: / style: / typo:)
  │                      finalWeight: 2  (APPROVED or COMMENTED, substantive)
  │                      finalWeight: 0  (APPROVED or COMMENTED, nit: / style: / typo:)
  │
  ├─ review threads    evidence-writer.ts:129  weightReviewThread(thread)
  │                    weighting.ts:72         !isResolved → baseWeight = 5
  │                    weighting.ts:85         isResolved  → baseWeight = 3
  │                    weighting.ts:84         → computeWeight(firstComment.body, { baseWeight })
  │                    weighting.ts:139          if isLowSignalReviewText(body): finalWeight -= 2
  │                    POSSIBLE OUTPUTS:
  │                      finalWeight: 5  (unresolved, substantive)
  │                      finalWeight: 3  (unresolved, nit: / style: / typo:)
  │                      finalWeight: 3  (resolved, substantive)
  │                      finalWeight: 1  (resolved, nit: / style: / typo:)
  │
  └─ CI checks         evidence-writer.ts:146  weightCheck(check)
                       weighting.ts:98         FAILURE or ERROR → hardcoded return
                       weighting.ts:107        any other state  → hardcoded return
                       NOTE: computeWeight is NOT called for checks
                       POSSIBLE OUTPUTS:
                         finalWeight: 4  (FAILURE or ERROR)
                         finalWeight: 1  (passing / neutral)
```

### `computeWeight` — the only function that adjusts finalWeight

```
src/learnings/weighting.ts:131  computeWeight(text, seed)
  finalWeight = seed.baseWeight
  if isLowSignalReviewText(text):    ← src/learnings/heuristics.ts:8
    penalties.push('low_signal_text')
    finalWeight -= 2
  if finalWeight < 0: finalWeight = 0
```

`isLowSignalReviewText` at `src/learnings/heuristics.ts:15` matches these prefixes only:
`nit:`, `nit `, `style:`, `style `, `typo:`, `typo `

### Boost labels that do NOT change finalWeight

The following labels appear in the `boosts` array for audit purposes but have no numeric effect
on `finalWeight`. The "boost" is baked into the hardcoded `baseWeight` for that type:

| Label | Where set | Actual numeric effect |
|---|---|---|
| `changes_requested` | `weighting.ts:47` | None — baseWeight is already 6 for this state |
| `approved` | `weighting.ts:51` | None |
| `unresolved_thread` | `weighting.ts:73` | None — baseWeight is already 5 for unresolved |
| `inline_code_comment` | `weighting.ts:81` | **None at all** — diff-anchored comments score identically to top-level thread comments |
| `outdated_thread` | `weighting.ts:77` | None — penalty label only, no subtraction |
| `pr_summary` | `evidence-writer.ts:55` | None — weight hardcoded directly |

### What passes the extraction threshold

`src/learnings/extractor.ts:~168` drops evidence with `final_weight < 3`
before the LLM is called. CI checks are also dropped by `source_type === 'pr_check'`
regardless of weight.

| Evidence type | finalWeight | Reaches LLM? |
|---|---|---|
| PR body | 5 | ✓ |
| Issue comment, substantive | 3 | ✓ |
| Issue comment, nit:/style:/typo: | 1 | ✗ |
| CHANGES_REQUESTED review, substantive | 6 | ✓ |
| CHANGES_REQUESTED review, nit: | 4 | ✓ |
| APPROVED/COMMENTED review, substantive | 2 | ✗ |
| Review thread, unresolved, substantive | 5 | ✓ |
| Review thread, unresolved, nit: | 3 | ✓ (barely) |
| Review thread, resolved, substantive | 3 | ✓ |
| Review thread, resolved, nit: | 1 | ✗ |
| CI failure/error | 4 | ✗ (source_type filter) |
| CI passing | 1 | ✗ |

### How weight feeds into confidence

Weight is passed to GPT-4o-mini in the user message (`src/learnings/extractor.ts`, `extractBatch`).
The system prompt instructs the model to derive confidence from it:

```
weight 6+ → confidence 0.85–0.95
weight 4–5 → confidence 0.65–0.80
weight 3   → confidence 0.50–0.60
clamp to [0.35, 0.95]
```

---

## Part 2 — LLM Extraction Context Scope

### What the model actually sees per evidence item

`src/learnings/extractor.ts` (`extractBatch`, approx. line 195) builds the user message
by formatting each eligible evidence record as:

```
## Evidence N
evidence_id: ev_abc123
source_type: pr_review_thread
weight: 5
author: reviewer1
title: Review thread on src/services/claude-cli-executor.ts:129

This inline comment explains the parsing failure.
```

Fields included when present: `evidence_id`, `source_type`, `weight`, `author`, `title`, `file_path`, `content`.

### What the model cannot see

| Information | Where it lives | Passed to LLM? |
|---|---|---|
| The actual code diff / patch hunk | GitHub API only — never ingested | ✗ |
| Surrounding code at the commented line | GitHub API only — never ingested | ✗ |
| Line numbers (`line_start`, `line_end`) | `EvidenceRecord` fields | ✗ (not in `extractBatch` format) |
| Reply comments in the same thread | Not ingested — only first comment captured | ✗ |
| Other comments from the same review session | Separate evidence items in a different batch | ✗ within a batch (may co-appear if batched together) |
| The PR description when evaluating a review thread | Separate `pull_request` evidence item | ✗ unless batched together |
| Commit messages associated with the PR | Never ingested | ✗ |

### Note on line numbers

`line_start` and `line_end` are stored on `EvidenceRecord`
(`src/learnings/record-types.ts:46–47`) and serialised to `evidence.jsonl`.
However, `extractBatch` only passes `ev.file_path` — not the line fields.
The line number reaches the LLM only implicitly, via `ev.title`
(`evidence-writer.ts:357`: `"Review thread on {path}:{line}"`), so it is present as
a string in the `title:` line but not as a structured field.

### Practical implication

A review thread comment like:

> "This should use a Map here for O(1) lookup"

is ingested with `file_path: src/services/cache.ts` and `line_start: 47`, but the LLM
sees only the comment text, the file name, and a weight. It has no idea:

- What the code at line 47 looked like before or after the PR
- What the reviewer was reacting to specifically
- Whether the PR author addressed the comment or pushed back

The lesson derived — "Use a Map for O(1) lookup" — may be more or less general than
the reviewer intended. The LLM has to infer generality from comment text alone.

### What the LLM does have that helps

- `source_type` tells it whether this was an unresolved inline thread (high-signal,
  specific) versus a general issue comment (lower-signal, possibly broad).
- `weight` correlates with how actionable the reviewer considered the feedback.
- `file_path` gives it module-level context (e.g., a comment on `src/learnings/extractor.ts`
  is more likely to be a `repo_convention` than one on `src/utils/string.ts`).
- The `title` field for review threads embeds the file and line as a string, giving
  the model weak positional context.

### The gap: diff context

The highest-value improvement to extraction quality would be fetching the diff hunk
surrounding the commented line from the GitHub API and including it in the evidence
`content` at ingest time. This is available via the GitHub REST API
(`GET /repos/{owner}/{repo}/pulls/{pull_number}/comments` — the `diff_hunk` field
on each review comment). It is not currently fetched or stored.
