# Research Prompt: Product Comparables for Repo-Native Learning System

## Goal

Research existing products, open-source projects, and adjacent workflows that are similar to this product direction:

- local-first or repo-native AI coding workflow augmentation
- persistent memory / learnings for coding agents
- GitHub PR and review-comment mining for reusable lessons
- Claude Code / Codex / agent workflow compounding
- team-shared knowledge that becomes actionable during development

This is for a pre-revenue, pre-customer startup. The goal is not a giant market map. The goal is to identify the smallest viable product direction, what to copy, what to avoid, and where the wedge is.

## Product Direction To Anchor On

Assume the target product currently looks like this:

- One committed repo-local SQLite database at repo root: `learnings.db`
- Primary runtime is Claude Code lifecycle integration
- Prompt-time retrieval happens on `UserPromptSubmit`
- Retrieval hits local knowledge only, not live GitHub, during normal prompt flow
- Main learning inputs:
  - GitHub PR discussion and review comments, especially human comments
  - prior Claude Code / Codex sessions and their derived learnings
- Capability creation is proposal-first and requires human approval
- Team wants the system to compound in the same repo where the work happens

## Research Questions

1. What products or projects are closest to this shape?
2. Which ones are genuinely repo-native or workflow-native rather than generic knowledge bases?
3. Which ones learn from development activity, code review, PRs, comments, incidents, or agent traces?
4. Which ones surface context at the right moment inside the dev workflow rather than as a separate dashboard?
5. How do they model:
   - evidence
   - distilled learnings / memories
   - rules / automations / suggestions
6. What is their UX for:
   - prompt-time recall
   - reviewing extracted learnings
   - approving promotion into durable behavior
7. Where are the sharpest simplifications we can make for an early-stage product?
8. What are the likely product traps?
   - overbuilding infra
   - building a dashboard instead of a workflow tool
   - indexing too much low-value data
   - poor signal-to-noise from unfiltered comments

## Scope

Cover:

- direct competitors
- adjacent tools worth learning from
- open-source projects with similar architecture or UX patterns
- products that mine code review / PR feedback / issue history / engineering artifacts for reusable knowledge
- products that provide coding-agent memory or repo memory

Do not spend much time on:

- generic enterprise wiki / PKM tools
- broad vector database vendors
- generic observability products unless they directly support agent or code-review learning loops

## Strong Hypotheses To Test

Test these explicitly. Do not assume they are true.

1. The right unit is not “artifact” but “evidence,” because the most valuable inputs are human review comments and discussion.
2. Human PR comments are much higher-value than raw code comments or machine-generated review output.
3. The best wedge is not “AI memory” in the abstract, but “make team lessons actionable during the next coding turn.”
4. Repo-native committed knowledge may create a stronger compounding loop than a separate hosted memory store.
5. A pre-customer startup should prefer a narrow, opinionated loop over a general-purpose knowledge platform.

## Deliverable Format

Produce a memo with these sections:

### 1. Executive Summary

- 5-10 bullets
- strongest product analogs
- strongest non-obvious insight
- simplest viable MVP recommendation

### 2. Comparable Set

For each comparable, include:

- product / project name
- URL
- category
- target user
- what is similar
- what is importantly different
- whether it is live, mature, early, or dormant

### 3. Pattern Breakdown

Compare how the strongest examples handle:

- source ingestion
- evidence curation
- memory / learning extraction
- prompt-time retrieval
- approval workflows
- team sharing
- local-first vs hosted architecture

### 4. What To Steal

- UX patterns
- data model ideas
- onboarding approach
- pricing / packaging lessons if visible

### 5. What To Avoid

- complexity traps
- bad abstractions
- missing workflow fit
- enterprise features we should defer

### 6. Recommended Product Wedge

Give a concrete recommendation for the first product:

- primary user
- primary problem
- minimal data sources
- minimal persisted entities
- one-sentence positioning

### 7. Evidence Table

Create a table with:

- claim
- source
- confidence
- why it matters

## Research Method

- Use current web research and cite sources
- Prefer primary sources:
  - official docs
  - product pages
  - release notes
  - GitHub repos
  - founder posts
- Use secondary analysis only to supplement
- Note research date explicitly
- Distinguish facts from inference

## Output Quality Bar

- Be concrete, not thematic
- Name products and projects
- Quote or paraphrase actual behavior, not just branding copy
- Call out uncertainty
- Optimize for decisions, not comprehensiveness

## Final Decision Question

End with:

“Given this landscape, if we had to ship a sharply-scoped v1 in 4-6 weeks, what exact product would we build first, and what would we explicitly not build yet?”
