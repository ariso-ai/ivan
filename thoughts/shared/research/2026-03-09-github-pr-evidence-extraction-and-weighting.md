# GitHub PR Evidence Extraction and Weighting for Learning Quality

## Executive Summary

The most reusable learnings come from human-to-human review discourse that includes rationale and results in a concrete outcome (author acknowledgement, an addressing code change, and/or a resolved thread that ships). Research on “useful” code review comments commonly operationalizes usefulness as leading to a nearby code change and/or explicit author acknowledgement, which aligns strongly with this product direction.

GitHub’s data model naturally supports a first-class evidence split between:

- PR conversation comments (`IssueComments`)
- review summaries (`PullRequestReviews` with state + optional body)
- inline review comment threads (diff-anchored comments grouped into threads with resolution/outdatedness)

These map well to distinct evidence types and weights.

“High volume != high signal” in code review: multiple studies report a large fraction of review comments are style/nitpicks, and “shallow review” that focuses on insignificant details is a recognized anti-pattern. This supports aggressive penalties for purely stylistic or `Nit:` comments, unless they are adopted as an explicit team convention.

Inline comments are often too local (file/line-specific) to promote directly into learnings unless they gain additional signals (reply/consensus/change). GitHub itself positions PR-level comments as overall direction and review comments as implementation within a file, which suggests different default weights.

Resolution signals should be treated as supporting evidence, not the evidence itself: GitHub supports marking threads resolved; GraphQL exposes `isResolved`, `isOutdated`, and `resolvedBy`, but resolution can be policy-driven or premature. Use it as a boost, not a threshold gate.

Final review state (`APPROVED`, `CHANGES_REQUESTED`, etc.) is weak without text; treat it as metadata that slightly adjusts confidence and helps rank which discussions mattered. GitHub explicitly defines review states and review events, but the evidence quality comes from the content and downstream change.

Strongest evidence combination to extract a learning in early product: reviewer claim + author acknowledgement + addressing code diff. This aligns with both industry ML work on resolving reviewer comments via code edits and academic definitions of “useful” comments.

For MVP, a hand-tuned policy can be meaningfully effective because:

- the evidence types are structurally distinct in GitHub
- common low-signal patterns are recognizable (`Nit:`, whitespace, typos)
- you can model usefulness with simple proxies (reply + code change + resolution)

Smallest viable weighting policy to ship first: score each discussion thread, boost for engagement and being addressed in subsequent commits, penalize nit/style, then create a learning only when the score crosses a threshold and the distilled statement is generalizable.

## Evidence Hierarchy

This hierarchy ranks PR evidence by expected learning signal per unit of noise and by how directly the signal can be attached to a reusable lesson.

### Triangulated lesson trail (comment -> acknowledgement -> code change -> shipped outcome)

Why it matters:

This is the closest practical proxy for review feedback that changed behavior, which literature often uses to define comment usefulness (nearby code change; explicit acknowledgement). It also matches modern code review’s documented role in improving solutions and knowledge transfer.

Failure modes:

The author may implement a change for expediency without internalizing the lesson, or the change may be unrelated refactoring. Mitigate with diff proximity and semantic match heuristics.

First-class at launch: Yes. This should be the primary learning trigger.

### Architectural/top-level PR conversation threads with rationale and multiple participants

Why it matters:

GitHub distinguishes PR-level comments as discussion about overall direction, which is exactly where reusable decision-making heuristics live (tradeoffs, rollout risk, invariants).

Failure modes:

Design by committee, bikeshedding, or organization-specific context that doesn’t generalize. Use penalties for lack of rationale and for highly contextual references.

First-class at launch: Yes, but only when there is explicit rationale and at least one acknowledgement/decision marker (`Let’s do X`, `Agreed`, `We should standardize`).

### Reviewer review summaries with substantive rationale

Why it matters:

A review submission is a structured unit: GitHub groups review comments under a review with a state and optional body. A rationale-bearing summary is already partly distilled, and it captures reviewer intent in one place.

Failure modes:

Empty-body reviews with only inline comments, perfunctory `LGTM`, or summaries that simply restate local diff details.

First-class at launch: Yes, but only count the text body as high-signal. Treat the state as low-signal metadata.

### Inline review threads that are engaged, resolved, and/or lead to subsequent commits

Why it matters:

Inline comments are targeted at implementation details; when they attract discussion or cause a follow-up edit, they often reveal a reusable micro-lesson (`avoid this footgun`, `prefer this API because...`). GitHub models these as threads with `isResolved`, `isOutdated`, and `resolvedBy`.

Failure modes:

Pure nits, local naming, comments on outdated diffs, or interface limitations where comments can only attach to changed lines.

First-class at launch: Yes, but with a low base weight and strong dependence on engagement/change signals.

### PR body text that includes risk/rollout notes, testing strategy, or invariants

Why it matters:

GitHub frames the Conversation tab as the hub containing the description, timeline, and discussion; PR descriptions can supply crucial context for a later extracted lesson.

Failure modes:

Many PR descriptions are incomplete, auto-generated, or drive-by. Copilot PR summaries do not consider existing PR description content, which can lead to misalignment if you treat generated text as ground truth.

First-class at launch: Yes, but primarily as context evidence, not as a primary learning source.

### Thread resolution status

Why it matters:

Resolution is a valuable meta-signal that a discussion was addressed; GitHub explicitly supports marking threads as resolved, and GraphQL exposes the fields needed to store it.

Failure modes:

Teams resolve to clean up without real agreement; authors may resolve before reviewer confirmation; resolution may reflect process norms more than truth.

First-class at launch: Yes as metadata; no as a standalone learning trigger.

### Merge outcome / closure outcome

Why it matters:

A merged outcome implies the final state shipped, and can boost confidence that the team accepted the decisions embodied by the final diff.

Failure modes:

Merged does not mean correct; urgency merges; post-merge reverts are not captured by merged alone.

First-class at launch: Yes, but low weight; better as a confidence modifier.

### Final review state alone

Why it matters:

It is structured and easy to store, and can help detect which PRs had friction.

Failure modes:

Click-approve behavior, cultural differences, approvals that hide shallow-review anti-patterns.

First-class at launch: Store it, but treat it as low-signal.

### Automated/bot comments and automated review output

Why it matters:

Sometimes bots catch real issues, but the goal here is reusable human team learning.

Failure modes:

High volume, duplicates, tool noise, and they often belong in lint rules rather than team learning.

First-class at launch: No. Ingest later, selectively, once there is a clear automation-to-policy story.

## Weighting Policy

This policy is designed for a repo-native, offline-first system: compute weights during ingestion, persist into `learnings.db`, and use weights + embeddings for retrieval during Claude Code prompt-time without live GitHub calls.

### Base weights per evidence type

| Evidence item | Base weight | Rationale |
| --- | --- | --- |
| Top-level PR conversation comment (human) | 5 | Often contains system-level reasoning |
| Review summary text (human) | 6 | Already a structured mini-distillation inside GitHub’s review model |
| Inline review thread root comment (human) | 3 | High density but often local specifics; requires boosts |
| Inline reply comment (human) | 2 | Replies indicate engagement; often clarify rationale |
| Author reply (human, PR author) | 4 | Author acknowledgement is a strong proxy for usefulness |
| PR description/body paragraph | 2 | Mostly context; sometimes contains testing/rollout/risk |
| Review state without text | 1 | Structured but weak without rationale |
| Merge outcome metadata | 1 | Corroboration only; not a lesson by itself |

### Boosts

Engagement boosts:

- `+3` if the thread has 2 or more distinct human participants
- `+2` if there is a direct author acknowledgement
- `+1` per additional substantive reply, capped at `+3`

Outcome boosts:

- `+6` if there is an addressing code change plausibly linked to the comment
- `+2` if the thread is resolved
- `+1` if the PR is merged

Rationale boosts:

- `+2` if the comment includes an explicit “in general / we should / prefer / avoid / guideline” framing

### Penalties

- `-6` if the comment is explicitly labeled `Nit:`
- `-4` if the comment is style-only / formatting-only / typo-only
- `-3` if the thread is outdated
- `-8` if the actor is a bot / automation account for the default learning extractor
- `-3` if the PR is closed unmerged

### When inline comments should matter less unless a human engages

Implement this directly with weighting mechanics:

- inline root comments have a low base (`3`)
- inline replies are mostly valuable as boost carriers
- require at least one of these to make an inline thread a learning candidate:
  - author reply
  - code change link
  - multi-participant discussion

### Diff context scoring

For MVP, avoid heavyweight semantic diffing. Use a 3-tier heuristic:

- Strong link (`+6`): comment is line-anchored and after the comment timestamp there exists a commit in the PR whose patch touches that file and a nearby range or includes a plausible textual match
- Medium link (`+3`): file changed after comment, but line proximity is unclear
- Weak link (`+0`): no subsequent commit touches the file

### Confidence model for extracted learnings

Store a confidence bucket and a numeric `confidence_score` alongside the learning.

- High confidence (`0.80–1.00`): total thread score >= `14` and has an addressed change signal and at least one acknowledgement or multi-participant boost
- Medium confidence (`0.55–0.79`): total score >= `10` with engagement but no strong proof of code change linkage
- Low confidence (`0.30–0.54`): total score >= `8` but lacks engagement or outcomes
- Do not extract (`<0.30`): default

Persist why as structured reasons (`boosts`, `penalties`) so the system can explain why a learning exists.

## Extraction Rules

These rules define when to create a learning row from evidence, and when to keep evidence only.

### Minimum evidence threshold

Create a learning when all are true:

- score threshold: a single thread achieves `thread_score >= 12`
- generalizability check: the distilled lesson can be expressed as a pattern rather than a one-off fix
- at least one usefulness proxy:
  - author acknowledges, or
  - code change link detected, or
  - 2 or more distinct human participants

### Sufficient evidence examples

Sufficient evidence typically contains at least two of these three:

- rationale-bearing reviewer statement + author acknowledgement
- rationale-bearing statement + addressing code change
- multi-participant agreement + resolution/merge metadata as corroboration

### Insufficient evidence examples

Do not create a learning when:

- the comment matches `Nit:` or is style-only and not explicitly adopted as a repo convention
- the only signal is review state (`approved`) with no rationale text
- the thread is outdated and there is no subsequent clarification

### Repo-specific convention vs general engineering lesson

Create a repo-specific convention when the content is tightly bound to:

- internal library/framework usage
- directory- or service-specific rules
- team workflow
- explicit “in this repo we do X” language

Create a general engineering lesson when the distilled statement:

- is phrased as a transferable heuristic
- includes rationale that is not dependent on internal names
- appears, or can plausibly appear, across multiple PRs

### Heuristics to separate nitpicks, style-only comments, conventions, and reusable lessons

Nitpicks / style-only:

- `Nit:` prefix
- keywords like `typo`, `whitespace`, `indent`, `format`, `alphabetize`
- changes that could be auto-detected by static analysis

Repo-specific conventions:

- direct references to internal modules, file paths, or naming standards
- requests to follow existing patterns for consistency

Broadly reusable lessons:

- explicit rationale and risk framing
- discussion of system properties such as idempotency, invariants, or observability
- framed as prefer/avoid rather than change this line

## Data Model Recommendation

This recommends minimum viable fields for `evidence` and `learning_evidence` that support:

- offline ingestion
- deterministic weighting
- explanation/debuggability
- prompt-time retrieval from local SQLite

### `evidence` table

Core identity and provenance:

- `id`
- `repository_id`
- `source_system`
- `source_type`
- `source_url`

PR linkage:

- `pr_number`
- `pr_node_id`
- `issue_number`
- `title`
- `base_ref`
- `head_ref`

Thread/review linkage:

- `review_id`
- `review_state`
- `thread_id`
- `comment_id`
- `in_reply_to_comment_id`

Diff anchors:

- `path`
- `diff_side`
- `line`
- `original_line`
- `start_line`
- `original_start_line`
- `subject_type`
- `is_resolved`
- `is_outdated`
- `resolved_by_login`

Actor metadata:

- `author_login`
- `author_is_bot`
- `author_role`
- `author_association`

Text and reaction signals:

- `body_text`
- `body_text_format`
- `reaction_counts_json`

Timing and ordering:

- `created_at`
- `updated_at`
- `commit_sha_at_time`
- `sequence_index`

Computed scoring and features:

- `base_weight`
- `weight_final`
- `boosts_json`
- `penalties_json`
- `is_nit`
- `is_style_only`
- `has_rationale_markers`
- `participants_count`
- `addressed_change_confidence`

### `learning_evidence` table

- `learning_id`
- `evidence_id`
- `repository_id`
- `contribution_weight`
- `relation_type`
- `extraction_reason`
- `created_at`

This join table is essential because GitHub’s review model naturally groups details, but learnings should typically cite multiple evidence items to avoid hallucinating lessons from a single comment.

## MVP Recommendation

This scope assumes:

- smallest high-signal launch
- no live GitHub calls at prompt-time
- a local `learnings.db` populated beforehand

### What to ingest first

Ingest only evidence required to support the highest-signal combinations:

- PR metadata + PR body (title, description, timestamps, merged/closed)
- top-level PR conversation comments via issue comments endpoints
- review submissions (review summaries) with state + body
- inline review threads including `isResolved`, `isOutdated`, `resolvedBy`, `path`, and line anchors, plus all thread comments
- commit/patch snippets for the PR sufficient to detect addressed change

### What to explicitly ignore for MVP

- bot/automation comments as learning evidence, except optionally as context
- reactions beyond simple aggregation
- labels, milestones, assignees, and workflow-level metadata
- external chat summaries unless posted into the PR

### What to defer until later

- cross-PR linkage for follow-up bugfix PR and revert detection
- learned rankers / ML weighting
- deep semantic change matching
- auto-summarized PR text as primary evidence

## Example Walkthroughs

### Strong learning candidate

A reviewer leaves a PR conversation comment:

> We should make this handler idempotent because retries can double-charge; please key off `request_id` and guard with a unique constraint.

Author replies:

> Good call, implemented idempotency with `request_id`.

Follow-up commit touches the handler and adds a uniqueness guard. Thread is resolved and PR is merged.

Score:

- Base: conversation comment (`5`) + author reply (`4`) = `9`
- Boosts: rationale (`+2`), acknowledgement (`+2`), addressed change (`+6`), resolved (`+2`), merged (`+1`)
- Score ~= `22`

Extract learning:

> For retryable handlers, enforce idempotency keyed by a stable request id; protect side effects with idempotency storage/constraints.

### Weak/noisy comment

Inline comment:

> Nit: extra blank line here

or

> rename `i` to `idx`

No replies, no further commits.

Score:

- Base: inline root (`3`)
- Penalty: nit (`-6`) or style-only (`-4`)

Do not extract.

### Inline comment that becomes strong because of response

Inline thread root:

> This lock is held while awaiting I/O; that can deadlock under load. Consider copying the data and releasing the lock before the await.

Author replies:

> Agreed, refactoring.

Next commit applies the restructuring; reviewer replies:

> Thanks, much safer.

Thread resolved.

Score:

- Base: inline root (`3`) + author reply (`4`) + inline reply (`2`) = `9`
- Boosts: rationale (`+2`), acknowledgement (`+2`), addressed change (`+6`), resolved (`+2`), multi-participant (`+3`)
- Score ~= `24`

Extract learning:

> Avoid holding locks across awaits / blocking operations; restructure to minimize critical sections.

### Architectural discussion that should become a learning

PR conversation thread debating pagination approach. Reviewer argues:

> Prefer cursor-based pagination; offset pagination is unstable under concurrent inserts and performs poorly at scale.

Another reviewer agrees; author updates API and adds tests.

Score:

- Base: conversation comment (`5`) + second participant comment (`5`) + author reply (`4`) = `14`
- Boosts: rationale (`+2`), multi-participant (`+3`), addressed change (`+6`), merged (`+1`)
- Score ~= `26`

Extract learning:

> For APIs with concurrent writes and large data sets, prefer cursor-based pagination to avoid instability and performance issues.

### Approval/review-state example that should not become a learning by itself

Reviewer submits an `APPROVE` review with body:

> LGTM

No substantive inline comment, no rationale.

Store it, but do not extract a learning.

## Sources and Confidence

Research date: March 9, 2026 (America/New_York)

### Primary sources used (high confidence, factual)

- GitHub documentation on PR structure, commenting, and review mechanics
- GitHub REST API docs for issue comments, PR reviews, and PR review comments
- GitHub GraphQL documentation for review thread resolution mutations and schema-level thread fields
- GitHub REST issue event types documentation for review event properties and `author_association`
- Academic/industry research establishing that modern code review delivers benefits like knowledge transfer and improved solutions, and documenting noise patterns
- Research survey evidence on how usefulness is defined (code-change proximity and author acknowledgement)
- Google Research blog documenting an applied system that proposes edits to resolve reviewer comments

### Adjacent products/systems (mixed confidence)

- GitHub Copilot PR summaries and Copilot code review documentation show an adjacent pattern: using diffs to produce summaries and reviewer guidance; however, this is not the same as extracting reusable lessons from human discourse.
- Swarmia guidance explicitly notes that PR discussions are searchable and valuable as a history log, which supports the product hypothesis that PR discourse is a high-value evidence source.

### What is factual vs inferred

Factual:

- GitHub’s evidence object types and the existence of review threads with resolution/outdatedness fields
- review states and review actions
- research findings about code review’s broader benefits and the prevalence of style/nit comments
- research definitions of comment usefulness

Inferred / design proposals:

- exact numeric weights, thresholds, and heuristic keyword lists
- how strongly resolved should boost confidence in your team culture
- the best cutoff between repo-specific convention and general lesson

## Final Decision Question

If we had to ship PR-based learning extraction quickly, what exact evidence types and weighting rules should we launch first, and what should we explicitly ignore until later?
