// Builds and persists EvidenceSignal JSONL files from raw GitHub PR payloads.
// Signals are lean pointer records (identity + scoring metadata + canonical URL).
// Content flows in-memory through the pipeline via EvidenceContextCache and is never persisted.

import fs from 'fs';
import { createDeterministicId } from './id.js';
import {
  EVIDENCE_JSONL_RELATIVE_PATH,
  resolveCanonicalLearningsPath
} from './paths.js';
import type {
  EvidenceSignal,
  EvidenceContext,
  EvidenceContextCache
} from './record-types.js';
import type { GitHubPullRequestEvidence } from './github-evidence.js';
import {
  inferAuthorFields,
  weightCheck,
  weightIssueComment,
  weightReview,
  weightReviewThread
} from './weighting.js';

/** Result of building signals from a PR payload. */
export interface BuildSignalsResult {
  signals: EvidenceSignal[];
  contextCache: EvidenceContextCache;
}

/**
 * Converts a `GitHubPullRequestEvidence` payload into lean `EvidenceSignal` objects
 * and a parallel `EvidenceContextCache` mapping signal IDs to their in-memory content.
 */
export function buildEvidenceSignalsFromPullRequest(
  payload: GitHubPullRequestEvidence
): BuildSignalsResult {
  const signals: EvidenceSignal[] = [];
  const contextCache: EvidenceContextCache = new Map();
  const now = new Date().toISOString();
  const baseExternalId = `github:${payload.repository.owner}/${payload.repository.name}:pr:${payload.pullRequest.number}`;
  const parentUrl = payload.pullRequest.url;

  // PR summary
  {
    const id = createDeterministicId('ev', `${baseExternalId}:summary`);
    signals.push({
      type: 'evidence',
      sourcePath: evidenceSourcePath(),
      id,
      source_system: 'github',
      source_type: 'pull_request',
      external_url: payload.pullRequest.url,
      ...(payload.pullRequest.author?.login && {
        author_type: 'human',
        author_name: payload.pullRequest.author.login
      }),
      base_weight: 5,
      final_weight: 5,
      boosts: ['pr_summary'],
      penalties: [],
      occurred_at: now,
      created_at: now,
      updated_at: now
    });
    contextCache.set(id, {
      title: payload.pullRequest.title,
      content: buildPullRequestSummaryBody(payload)
    });
  }

  // Issue comments
  for (const comment of payload.issueComments) {
    const id = createDeterministicId(
      'ev',
      `${baseExternalId}:issue-comment:${comment.id}`
    );
    const weight = weightIssueComment(comment);
    const author = inferAuthorFields(comment.author?.login);
    signals.push({
      type: 'evidence',
      sourcePath: evidenceSourcePath(),
      id,
      source_system: 'github',
      source_type: 'pr_issue_comment',
      external_url: comment.url,
      parent_url: parentUrl,
      ...author,
      base_weight: weight.baseWeight,
      final_weight: weight.finalWeight,
      boosts: weight.boosts,
      penalties: weight.penalties,
      occurred_at: comment.createdAt,
      created_at: now,
      updated_at: now
    });
    contextCache.set(id, {
      title: `PR issue comment by ${comment.author?.login ?? 'unknown'}`,
      content: comment.body.trim()
    });
  }

  // Reviews
  for (const review of payload.reviews) {
    const id = createDeterministicId(
      'ev',
      `${baseExternalId}:review:${review.id}`
    );
    const weight = weightReview(review);
    const author = inferAuthorFields(review.author?.login);
    signals.push({
      type: 'evidence',
      sourcePath: evidenceSourcePath(),
      id,
      source_system: 'github',
      source_type: 'pr_review',
      external_url: review.url,
      parent_url: parentUrl,
      ...author,
      base_weight: weight.baseWeight,
      final_weight: weight.finalWeight,
      boosts: weight.boosts,
      penalties: weight.penalties,
      ...(review.submittedAt !== undefined && {
        occurred_at: review.submittedAt
      }),
      created_at: now,
      updated_at: now
    });
    contextCache.set(id, {
      title: `Review ${review.state} by ${review.author?.login ?? 'unknown'}`,
      content: review.body.trim() || review.state
    });
  }

  // Review threads
  for (const thread of payload.reviewThreads) {
    const firstComment = thread.comments[0];
    if (!firstComment) continue;

    const threadId = thread.id ?? firstComment.id;
    const id = createDeterministicId(
      'ev',
      `${baseExternalId}:thread:${threadId}`
    );
    const weight = weightReviewThread(thread);
    const author = inferAuthorFields(firstComment.author?.login);

    signals.push({
      type: 'evidence',
      sourcePath: evidenceSourcePath(),
      id,
      source_system: 'github',
      source_type: 'pr_review_thread',
      external_url: firstComment.url,
      parent_url: parentUrl,
      ...author,
      base_weight: weight.baseWeight,
      final_weight: weight.finalWeight,
      boosts: weight.boosts,
      penalties: weight.penalties,
      occurred_at: firstComment.createdAt,
      created_at: now,
      updated_at: now
    });

    const context: EvidenceContext = {
      title: buildThreadTitle(firstComment.path, firstComment.line),
      content: firstComment.body.trim(),
      ...(firstComment.path !== undefined && { file_path: firstComment.path }),
      ...(firstComment.line !== undefined && { line_start: firstComment.line }),
      ...(firstComment.line !== undefined && { line_end: firstComment.line }),
      ...(firstComment.diffHunk !== undefined && { diff_hunk: firstComment.diffHunk })
    };
    contextCache.set(id, context);
  }

  // Checks
  for (const check of payload.checks) {
    const id = createDeterministicId(
      'ev',
      `${baseExternalId}:check:${check.name}:${check.state}`
    );
    const weight = weightCheck(check);
    signals.push({
      type: 'evidence',
      sourcePath: evidenceSourcePath(),
      id,
      source_system: 'github',
      source_type: 'pr_check',
      external_url: check.link,
      parent_url: parentUrl,
      base_weight: weight.baseWeight,
      final_weight: weight.finalWeight,
      boosts: weight.boosts,
      penalties: weight.penalties,
      occurred_at: now,
      created_at: now,
      updated_at: now
    });
    contextCache.set(id, {
      title: `Check ${check.state}: ${check.name}`,
      content: `${check.name} -> ${check.state}`
    });
  }

  return {
    signals: signals.sort((left, right) =>
      left.source_type.localeCompare(right.source_type)
    ),
    contextCache
  };
}

/**
 * Upserts `signals` into `.ivan/evidence.jsonl`, merging with existing data
 * by id (new signals win).
 * Returns the `{filePath}#L{n}` source paths for every signal written.
 */
export function writeEvidenceSignals(
  repoPath: string,
  signals: EvidenceSignal[]
): string[] {
  const filePath = resolveCanonicalLearningsPath(repoPath, 'evidence.jsonl');
  const merged = mergeEvidenceSignals(filePath, signals)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((signal) => ({ ...signal, sourcePath: evidenceSourcePath() }));

  const content = merged
    .map((signal) => `${JSON.stringify(serializeEvidenceSignal(signal))}\n`)
    .join('');
  fs.writeFileSync(filePath, content, 'utf8');

  return merged.map((_signal, index) => `${filePath}#L${index + 1}`);
}

/** Loads any existing JSONL at `filePath` into an id-keyed map, then upserts `signals` on top. */
function mergeEvidenceSignals(
  filePath: string,
  signals: EvidenceSignal[]
): EvidenceSignal[] {
  const byId = new Map<string, EvidenceSignal>();

  if (fs.existsSync(filePath)) {
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      const parsed = JSON.parse(line) as EvidenceSignal;
      byId.set(parsed.id, parsed);
    }
  }

  for (const signal of signals) {
    byId.set(signal.id, signal);
  }

  return [...byId.values()];
}

/** Produces a plain-object representation of an `EvidenceSignal` for JSON serialization. */
function serializeEvidenceSignal(signal: EvidenceSignal): Record<string, unknown> {
  return {
    id: signal.id,
    source_system: signal.source_system,
    source_type: signal.source_type,
    external_url: signal.external_url,
    parent_url: signal.parent_url,
    author_name: signal.author_name,
    author_type: signal.author_type,
    occurred_at: signal.occurred_at,
    base_weight: signal.base_weight,
    final_weight: signal.final_weight,
    boosts: signal.boosts,
    penalties: signal.penalties,
    created_at: signal.created_at,
    updated_at: signal.updated_at
  };
}

/** Returns the canonical relative path for the evidence JSONL file (without a line number). */
function evidenceSourcePath(): string {
  return EVIDENCE_JSONL_RELATIVE_PATH;
}

/** Assembles a human-readable summary of the PR (number + title + body + changed files) as the evidence content. */
function buildPullRequestSummaryBody(
  payload: GitHubPullRequestEvidence
): string {
  const sections: string[] = [];
  sections.push(
    `PR #${payload.pullRequest.number}: ${payload.pullRequest.title}`
  );

  if (payload.pullRequest.body.trim()) {
    sections.push(payload.pullRequest.body.trim());
  }

  if (payload.files.length > 0) {
    sections.push(
      `Changed files:\n${payload.files
        .map((file) => `- ${file.path}`)
        .join('\n')}`
    );
  }

  return sections.join('\n\n');
}

/** Formats a human-readable title for a review thread, including file path and line number when available. */
function buildThreadTitle(filePath?: string, line?: number): string {
  if (!filePath) {
    return 'Review thread';
  }

  if (line === undefined) {
    return `Review thread on ${filePath}`;
  }

  return `Review thread on ${filePath}:${line}`;
}
