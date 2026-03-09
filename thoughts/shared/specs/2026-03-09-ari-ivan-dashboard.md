# Ari Ivan Dashboard Specification

## Executive Summary

Build a new standalone public dashboard that proves the collaboration loop between Ari and Ivan for SciSummary.

The product goal is two-fold:

- give viewers an immediate gestalt of Ari and Ivan working together
- create a public proof artifact that generates buzz and can be shared as a viral marketing surface

The dashboard has three top-level modes:

- `Ari`
- `Ari <-> Ivan`
- `Ivan`

The default landing page is `Ari <-> Ivan`.

The `Ari` and `Ivan` pages behave like ambient live wallboards with light detail expansion. The `Ari <-> Ivan` page is the hero narrative surface and is organized around structured collaboration `stories`.

## Problem Statement

Today, Ari and Ivan may each produce useful operational evidence, but there is no single public artifact that shows:

- Ari capturing customer demand and operator insights
- Ivan turning that demand into engineering execution
- SciSummary improving through a visible operator-engineer feedback loop

Without that artifact:

- external viewers do not get a quick proof of progress
- the collaboration is hard to explain at a glance
- Ari and Ivan look like separate systems instead of a coherent business engine

This dashboard solves that by turning scattered activity into a public-safe, near-real-time proof surface.

## Success Criteria

### Product Success

- A viewer can understand the Ari and Ivan relationship within a few seconds.
- A viewer can see that Ari captures demand and Ivan ships against it.
- The dashboard feels alive, current, and credible without exposing sensitive data.

### Business Success

- The dashboard is usable as a proof artifact in external conversations.
- The dashboard is shareable enough to generate buzz.
- The dashboard becomes the canonical public representation of Ari and Ivan collaboration for SciSummary.

### Operational Success

- Metrics stay fresh within roughly 1 to 5 minutes.
- Public-safe redaction is reliable by default.
- The system can be rebuilt from source systems and later extended to support historical backfill.

## Stakeholders And Users

### Primary Audience

- public viewers
- prospective customers
- partners
- investors
- social audiences encountering the artifact

### Secondary Audience

- Ari / Ariso internal team reviewing the public artifact

### Deferred Audience

- internal operators using richer debug or raw-data views

Internal mode is intentionally deferred from v1 scope, though the architecture should make it possible later.

## Core Product Thesis

The dashboard should make one loop repeatedly visible:

`customer signal -> Ari insight -> Ivan engineering task -> PR -> release note -> business delta`

This loop is the product, not just the metric pages.

## Information Architecture

## Top-Level Modes

### 1. `Ari`

Purpose:
Show Ari as the operator layer.

Behavior:
Ambient live wallboard with light expansion.

Primary metric families:

- emails sent or replied to
- feature requests or insights generated
- feedback gathered
- conversion-related signals
- revenue-growth signals
- shipped features and release notes

### 2. `Ari <-> Ivan`

Purpose:
Show collaboration as the hero story.

Behavior:
Narrative wallboard with structured `stories` plus live signals.

Required above-the-fold modules:

- hero proof statement
- pipeline timeline
- live handoff feed
- shipped outcomes and release notes
- Ari KPI strip
- Ivan KPI strip

### 3. `Ivan`

Purpose:
Show Ivan as the engineering execution layer.

Behavior:
Ambient live wallboard with light expansion.

Primary metric families:

- PRs opened
- PRs merged
- median time from signal to PR
- active engineering tasks
- success rate or completion rate
- build or test pass rate
- release notes generated
- repositories touched

## User Experience

## Default Page Behavior

The default landing page is `Ari <-> Ivan`.

Expected first impression:

- a clear proof statement
- recent stories proving the operator-to-engineer loop
- a visible live feed that makes the system feel active

The default experience is primarily ambient, not workflow-oriented. Users should not need to click through a deep product flow to understand the point.

## Interaction Model

### Ari And Ivan Pages

- primarily ambient wallboards
- light detail expansion only
- no heavy drill-down workflow required for value

### Ari <-> Ivan Page

- story-centric
- shows structured narrative progression
- may allow lightweight expansion of recent stories
- should feel like a hybrid of wallboard and causal timeline

## Story Model

`Story` is the canonical collaboration object.

A story consists of these conceptual stages:

- `signal`
- `insight`
- `engineering_task`
- `pr`
- `release_note`

`business_delta` is not embedded as a mandatory story stage.

Instead:

- `business_delta` is a separate event or metric object
- it may optionally be attributed to one or more stories
- attribution should support confidence or evidence metadata later

This avoids overstating causality while still allowing the dashboard to connect outcomes back to work.

## Data Model

This is a conceptual launch model, not a locked SQL schema.

### 1. `stories`

Purpose:
Represent a public-safe collaboration narrative between Ari and Ivan.

Suggested fields:

- `id`
- `title`
- `public_summary`
- `status`
- `started_at`
- `updated_at`
- `expires_at`
- `primary_business_area`
- `confidence_score`
- `is_public`

Notes:

- `expires_at` should default to about 7 days for timeline visibility.
- A story may outlive its public timeline presence in storage.

### 2. `story_events`

Purpose:
Store the normalized event chain inside a story.

Suggested fields:

- `id`
- `story_id`
- `event_type`
- `source_system`
- `source_ref`
- `public_text`
- `private_text_redacted`
- `actor`
- `occurred_at`
- `metadata_json`

Event types should support at least:

- `signal`
- `insight`
- `engineering_task`
- `pr_opened`
- `pr_merged`
- `release_note`
- `business_delta_attributed`

### 3. `business_deltas`

Purpose:
Track business movement independently from stories.

Suggested fields:

- `id`
- `metric_key`
- `delta_direction`
- `delta_percent`
- `absolute_value_redacted`
- `occurred_at`
- `source_system`
- `public_summary`

### 4. `story_business_deltas`

Purpose:
Link business deltas to stories when attribution exists.

Suggested fields:

- `story_id`
- `business_delta_id`
- `attribution_kind`
- `attribution_confidence`
- `note`

### 5. `metric_snapshots`

Purpose:
Store periodic cached metric values for wallboard rendering.

Suggested fields:

- `id`
- `page_scope`
- `metric_key`
- `metric_value`
- `metric_display_value`
- `captured_at`
- `window_start`
- `window_end`
- `source_system`

### 6. `ingestion_runs`

Purpose:
Track connector sync health.

Suggested fields:

- `id`
- `source_system`
- `status`
- `started_at`
- `finished_at`
- `items_seen`
- `items_written`
- `error_summary_redacted`

### 7. `source_mappings`

Purpose:
Link source-system identifiers to normalized entities.

Suggested fields:

- `id`
- `source_system`
- `external_id`
- `entity_type`
- `entity_id`
- `created_at`

## Source Systems And Integration Assumptions

V1 should plan for integration points, but detailed connector discovery is intentionally deferred.

### Ari-Side Sources

- Ari event log or existing Ari APIs
- Gmail access through Ari-controlled integration points
- Slack access through Ari-controlled integration points
- Stripe access for growth and revenue-adjacent signals

### Ivan-Side Sources

- Ivan local data and job/task records
- GitHub repositories, pull requests, statuses, and release-note material

### Derived Sources

- paraphrased release notes
- public-safe story summaries
- calculated business delta summaries

## Redaction And Public-Safe Rules

Public mode is the only in-scope v1 mode.

Default redaction rules:

- never show email addresses
- never show customer names
- never show workspace identifiers
- never show exact revenue numbers
- show revenue as directional or percentage movement only
- always paraphrase raw Slack and email content
- normalize engineering task text before public display when needed
- show PR title and link only when public-safe and already public

Recommended public text policy:

- `signal` is paraphrased
- `insight` is paraphrased
- `engineering_task` is lightly normalized
- `pr` may expose title and link if public
- `release_note` is a public-safe summary
- `business_delta` is directional or percentage-based only

## Functional Requirements

## Must Have (P0)

- Public Next.js app with three top-level modes: `Ari`, `Ari <-> Ivan`, `Ivan`
- `Ari <-> Ivan` as the default landing page
- Above-the-fold modules on `Ari <-> Ivan`:
  - hero proof statement
  - pipeline timeline
  - live handoff feed
  - shipped outcomes and release notes
  - Ari KPI strip
  - Ivan KPI strip
- Ambient metric pages for Ari and Ivan with light expansion
- Canonical `story` model connecting signal, insight, engineering task, PR, and release note
- Metric snapshots cached in SQLite
- Live event feed showing recent activity
- Scheduled ingestion jobs refreshing data within roughly 1 to 5 minutes
- Public-safe redaction applied before dashboard rendering
- Release-note display derived from merged PR plus tagged or paraphrased release note
- Support for at least recent public timeline visibility on the order of 7 days

## Should Have (P1)

- Story attribution to one or more business deltas
- Basic ingestion health visibility on the dashboard
- Rebuildable ingestion pipeline so cache can be dropped and reconstructed
- Data model support for later historical backfill
- Lightweight story expansion on the collaboration page

## Nice To Have (P2)

- Internal mode with richer traces
- Backfill orchestration UI or admin controls
- More nuanced causal confidence scoring between stories and business deltas
- Experimental CRDT-like or ultra-live shared state for story rendering

## Non-Functional Requirements

- Freshness: metric and event data should appear within 1 to 5 minutes of source changes
- Scale: design for low initial traffic, around tens of concurrent public viewers, while tolerating short-term spikes
- Event volume: Ari may emit thousands of events per day; Ivan may emit tens to hundreds depending on granularity
- Reliability: a source connector failure should degrade specific modules rather than take down the whole dashboard
- Rebuildability: cached data should be disposable and reconstructible from source systems
- Security: source secrets stay server-side; the public app only sees redacted material
- Performance: initial page load should feel instant from cached snapshots and precomputed story summaries

## Architecture

## High-Level Shape

- one standalone Next.js app
- no microservices
- server-side scheduled ingestion jobs
- SQLite for cached metrics, normalized public events, stories, and config
- server-side API routes or server functions for page data

This is not a purely static site.

Instead it is a mostly cached site with:

- snapshot-style metrics for wallboard surfaces
- a recent event or story feed that updates from scheduled ingestion

This resolves the product requirement of feeling live without requiring the browser to query raw third-party systems directly.

## Rendering Strategy

Recommended rendering mix:

- server-rendered or statically optimized page shells
- cached metric snapshots for fast paint
- server-fetched recent event or story data
- optional incremental refresh behavior later if needed

## Ingestion Strategy

Recommended ingestion pattern:

- each source adapter reads from its source on a schedule
- adapter output is normalized into internal event shapes
- public-safe summaries are produced during normalization
- stories are assembled or updated from normalized events
- metric snapshots are recomputed and cached

## Failure Strategy

- connector failures should be isolated per source
- stale modules should continue rendering last known good values
- ingestion health can be surfaced as a lightweight dashboard signal

## Security Model

- all third-party credentials remain server-side
- public frontend never receives raw Gmail, Slack, or Stripe payloads
- redaction happens before content becomes dashboard-readable
- public mode is the only in-scope mode for v1 delivery
- later internal mode should be a separate visibility layer, not mixed into the public data path

## Out Of Scope

- manual annotation tools
- manual retry actions triggered from the public dashboard
- human notifications outside the dashboard surface
- full internal mode implementation
- full historical backfill orchestration
- mobile-specific optimization as a primary goal
- exposing exact revenue values publicly
- exposing raw agent transcripts publicly

## Recommended Delivery Plan

### Phase 1: Foundations

- scaffold standalone Next.js app
- define normalized SQLite schema
- implement source adapter interfaces as stubs
- implement public-safe text policy utilities
- implement story assembly logic

### Phase 2: Ivan And GitHub Proof

- ingest Ivan local task and job data
- ingest GitHub PR and merge information
- generate release-note summaries from merged work
- populate `Ivan` page and part of `Ari <-> Ivan`

### Phase 3: Ari Public Loop

- ingest Ari event-log or Ari API data
- map Ari-side signals and insights into stories
- compute Ari KPI snapshots
- populate `Ari` page and complete collaboration stories

### Phase 4: Public Polish

- refine ambient wallboard presentation
- add live handoff feed behavior
- tighten public-safe copy and redaction review
- validate buzz-worthiness of hero proof statements

### Phase 5: Deferred Extensions

- internal mode
- richer attribution modeling
- historical backfill execution
- improved ingestion observability

## Open Questions For Implementation

These are intentionally deferred and should be researched later rather than block the spec:

- exact Ari API and event-log surfaces
- exact Gmail, Slack, and Stripe access shape through Ari-controlled integrations
- exact GitHub repositories and release-note derivation rules
- whether SQLite remains sufficient after real traffic and event volume
- whether page refresh alone is sufficient or if push mechanisms are worth adding later

## Appendix: Research Findings

### Product Inspiration

- Polsia live dashboard demonstrates the target vibe: always-on task feed, business metrics, communication surfaces, and live operational proof
  - https://polsia.com/live

### Ari Public Positioning

- Ari is presented publicly as an operator or management system organized around `Align`, `Enable`, `Coach`, and `Retain`, with Slack and Google Workspace integration as core product framing
  - https://ariso.ai/

### SciSummary Public Business Surface

- SciSummary exposes public pricing, subscription, API, and affiliate surfaces, which makes it a good fit for public-safe growth and product metrics
  - https://scisummary.com/
  - https://scisummary.com/api/pricing
  - https://scisummary.com/affiliates

### Ivan Existing System Context

- Ivan already has local job, task, log, and PR-oriented data structures plus a simple web dashboard, which provides a practical starting point for Ivan-side ingestion
  - `/Users/michaelgeiger/Developer/repos/ivan/src/web-server.ts`
  - `/Users/michaelgeiger/Developer/repos/ivan/src/database/types.ts`
  - https://github.com/ariso-ai/ivan
