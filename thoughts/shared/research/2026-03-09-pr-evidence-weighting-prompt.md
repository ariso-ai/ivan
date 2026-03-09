# Research Prompt: GitHub PR Evidence Extraction and Weighting for Learning Quality

## Goal

Research how we should extract, classify, and weight GitHub pull request evidence so we can turn high-signal PR activity into reusable team learnings.

This is a core product question.

The product direction is:

- repo-native learning system
- local committed SQLite database: `learnings.db`
- Claude Code prompt-time retrieval from local knowledge
- learnings are distilled from prior evidence, not manually entered by default
- strongest current hypothesis: human PR discussion is the highest-value evidence source

## Product Context

Assume this launch model:

- persisted launch model:
  - `repositories`
  - `evidence`
  - `learnings`
  - `learning_evidence`
  - `learning_tags`
  - derived lexical/vector indexes
- `repository_id` exists from day one even if first deployment is repo-local
- runtime jobs and orchestration state stay in memory for now
- no live GitHub fetches during normal `UserPromptSubmit` retrieval
- GitHub ingestion happens ahead of time and populates local knowledge

## Core Question

What GitHub PR signals should count as first-class evidence for learning extraction, and how should we weight them so the system learns useful team lessons instead of noisy review chatter?

## Research Questions

1. Which PR evidence types are most likely to contain reusable engineering lessons?
2. Which evidence types are usually too noisy, too local, or too low-signal to promote directly into learnings?
3. How should we weight:
   - human review summaries
   - human inline review comments
   - human PR conversation comments
   - author responses
   - resolved vs unresolved discussion
   - PR body text
   - final review state
   - merge outcome
   - follow-up fix commits
4. When should inline comments matter less unless a human engages with them?
5. What heuristics best separate:
   - one-off nitpicks
   - style-only comments
   - repo-specific conventions
   - broadly reusable engineering lessons
6. What evidence combinations are strongest for extracting a learning?
   - example: reviewer comment + author acknowledgement + follow-up code change
7. How should code diff context affect learning extraction?
8. How should we model confidence for extracted learnings?
9. What similar products or research systems mine code review or PR discourse for lessons, if any?
10. What is the smallest viable evidence-weighting policy we can ship first?

## Strong Hypotheses To Test

Test these directly.

1. Human comments are the highest-value PR evidence.
2. Inline code comments are weak evidence unless they trigger a human response or code change.
3. Reviewer comment + author response + landed diff is far higher signal than any one item alone.
4. PR body text is useful mainly as context, not as the primary learning source.
5. Final review state alone is weak evidence unless paired with substantive discussion.
6. A simple hand-tuned weighting policy may outperform a complicated learned ranker at this stage.

## Evidence Types To Evaluate

Evaluate these explicitly:

### A. PR body

- original problem framing
- proposed change summary
- rollout / risk notes

### B. Review summary

- approve / request changes / comment
- summary rationale

### C. Inline review comments

- file/line-specific comments
- thread depth
- whether discussion happened

### D. General PR conversation comments

- top-level discussion
- architectural reasoning
- post-review clarifications

### E. Author replies

- acknowledgement
- disagreement
- explanation
- promise to change

### F. Diff / commit evidence

- whether the code changed after comment
- whether change appears to implement the suggestion

### G. Resolution / outcome evidence

- merged
- closed unmerged
- reverted later
- follow-up bugfix PR if detectable

## Required Output

Produce a memo with these sections.

### 1. Executive Summary

- 5-10 bullets
- strongest evidence types
- lowest-value evidence types
- smallest viable weighting policy

### 2. Evidence Hierarchy

Create a ranked hierarchy of PR evidence from highest signal to lowest signal.

For each item, include:

- why it matters
- failure modes
- whether it should be first-class at launch

### 3. Weighting Policy

Propose a practical launch weighting model.

It should include:

- base weight per evidence type
- boosts
- penalties
- confidence heuristics

Example dimensions to consider:

- human vs automated source
- reply from PR author
- explicit acknowledgement
- implemented in later commit
- repeated theme across PRs
- style-only / nit-only phrasing
- resolution status

### 4. Extraction Rules

Propose concrete rules for when to create a learning.

Include:

- minimum evidence threshold
- examples of sufficient evidence
- examples of insufficient evidence
- when to create a repo-specific convention vs a general engineering lesson

### 5. Data Model Recommendation

Recommend the minimum fields needed on `evidence` and `learning_evidence`.

Include likely fields such as:

- `repository_id`
- source system
- source type
- author role
- textual content
- PR identifier
- review/thread identifiers
- file/line references when available
- timestamps
- relationship to reply / thread / resolution
- confidence / weight / reason fields

### 6. MVP Recommendation

Recommend the smallest viable PR learning ingestion scope for launch.

Be explicit about:

- what to ingest
- what to ignore
- what to defer

### 7. Example Walkthroughs

Give at least 5 examples:

- strong learning candidate
- weak/noisy comment
- inline comment that becomes strong because of response
- architectural discussion that should become a learning
- approval/review-state example that should not become a learning by itself

### 8. Sources and Confidence

- list sources
- mark which conclusions are factual vs inferred
- note research date

## Research Method

- Prefer primary sources:
  - GitHub docs
  - official product docs
  - engineering blog posts with implementation detail
  - academic or industry writeups on code review quality if useful
- Use current sources
- Distinguish facts from design inference
- Optimize for actionable product decisions, not taxonomy completeness

## Important Constraints

- pre-revenue startup
- team wants the smallest high-signal launch
- no heavyweight ML ranking system unless clearly justified
- no live GitHub calls in prompt-time retrieval path
- recall must use local knowledge only during normal Claude Code interaction

## Final Decision Question

End with:

“If we had to ship PR-based learning extraction quickly, what exact evidence types and weighting rules should we launch first, and what should we explicitly ignore until later?”
