// Builds and persists EvidenceRecord JSONL files from raw GitHub PR payloads.
// Records are deterministically identified and upserted (new data overwrites old)
// so re-ingesting a PR is safe and idempotent.

import fs from 'fs';
import { createDeterministicId } from './id.js';
import {
  EVIDENCE_JSONL_RELATIVE_PATH,
  resolveCanonicalLearningsPath
} from './paths.js';
import type { EvidenceRecord } from './record-types.js';
import type {
  GitHubPullRequestEvidence,
  GitHubReviewThreadEvidence
} from './github-evidence.js';
import {
  inferAuthorFields,
  weightCheck,
  weightIssueComment,
  weightReview,
  weightReviewThread
} from './weighting.js';

/**
 * Converts a `GitHubPullRequestEvidence` payload into a flat list of `EvidenceRecord` objects—
 * one per PR summary, issue comment, review, review thread, and CI check.
 * Each record is weighted and sorted by `source_type` for deterministic JSONL output.
 */
export function buildEvidenceRecordsFromPullRequest(
  repositoryId: string,
  payload: GitHubPullRequestEvidence
): EvidenceRecord[] {
  const records: EvidenceRecord[] = [];
  const now = new Date().toISOString();
  const baseExternalId = `github:${payload.repository.owner}/${payload.repository.name}:pr:${payload.pullRequest.number}`;

  records.push({
    type: 'evidence',
    sourcePath: evidenceSourcePath(),
    id: createDeterministicId('ev', `${baseExternalId}:summary`),
    repository_id: repositoryId,
    source_system: 'github',
    source_type: 'pull_request',
    external_id: baseExternalId,
    url: payload.pullRequest.url,
    pr_number: payload.pullRequest.number,
    title: payload.pullRequest.title,
    content: buildPullRequestSummaryBody(payload),
    author_type: payload.pullRequest.author?.login ? 'human' : undefined,
    author_name: payload.pullRequest.author?.login,
    base_weight: 5,
    final_weight: 5,
    boosts: ['pr_summary'],
    penalties: [],
    occurred_at: now,
    created_at: now,
    updated_at: now
  });

  for (const comment of payload.issueComments) {
    const id = createDeterministicId('ev', `${baseExternalId}:issue-comment:${comment.id}`);
    const weight = weightIssueComment(comment);
    const author = inferAuthorFields(comment.author?.login);
    records.push({
      type: 'evidence',
      sourcePath: evidenceSourcePath(),
      id,
      repository_id: repositoryId,
      source_system: 'github',
      source_type: 'pr_issue_comment',
      external_id: `${baseExternalId}:issue-comment:${comment.id}`,
      parent_external_id: baseExternalId,
      url: comment.url,
      pr_number: payload.pullRequest.number,
      title: `PR issue comment by ${comment.author?.login ?? 'unknown'}`,
      content: comment.body.trim(),
      ...author,
      base_weight: weight.baseWeight,
      final_weight: weight.finalWeight,
      boosts: weight.boosts,
      penalties: weight.penalties,
      occurred_at: comment.createdAt,
      created_at: now,
      updated_at: now
    });
  }

  for (const review of payload.reviews) {
    const id = createDeterministicId('ev', `${baseExternalId}:review:${review.id}`);
    const weight = weightReview(review);
    const author = inferAuthorFields(review.author?.login);
    records.push({
      type: 'evidence',
      sourcePath: evidenceSourcePath(),
      id,
      repository_id: repositoryId,
      source_system: 'github',
      source_type: 'pr_review',
      external_id: `${baseExternalId}:review:${review.id}`,
      parent_external_id: baseExternalId,
      url: review.url,
      pr_number: payload.pullRequest.number,
      review_id: review.id,
      title: `Review ${review.state} by ${review.author?.login ?? 'unknown'}`,
      content: review.body.trim() || review.state,
      review_state: review.state,
      ...author,
      base_weight: weight.baseWeight,
      final_weight: weight.finalWeight,
      boosts: weight.boosts,
      penalties: weight.penalties,
      occurred_at: review.submittedAt,
      created_at: now,
      updated_at: now
    });
  }

  for (const thread of payload.reviewThreads) {
    const threadRecord = buildThreadEvidenceRecord(
      repositoryId,
      payload,
      thread,
      baseExternalId,
      now
    );
    if (threadRecord) {
      records.push(threadRecord);
    }
  }

  for (const check of payload.checks) {
    const id = createDeterministicId('ev', `${baseExternalId}:check:${check.name}:${check.state}`);
    const weight = weightCheck(check);
    records.push({
      type: 'evidence',
      sourcePath: evidenceSourcePath(),
      id,
      repository_id: repositoryId,
      source_system: 'github',
      source_type: 'pr_check',
      external_id: `${baseExternalId}:check:${check.name}`,
      parent_external_id: baseExternalId,
      url: check.link,
      pr_number: payload.pullRequest.number,
      title: `Check ${check.state}: ${check.name}`,
      content: `${check.name} -> ${check.state}`,
      base_weight: weight.baseWeight,
      final_weight: weight.finalWeight,
      boosts: weight.boosts,
      penalties: weight.penalties,
      occurred_at: now,
      created_at: now,
      updated_at: now
    });
  }

  return records.sort((left, right) => left.source_type.localeCompare(right.source_type));
}

/**
 * Upserts `records` into `.ivan/evidence.jsonl`, merging with existing data
 * by id (new records win).
 * Returns the `{filePath}#L{n}` source paths for every record written.
 */
export function writeEvidenceRecords(
  repoPath: string,
  _repositoryId: string,
  records: EvidenceRecord[]
): string[] {
  const filePath = resolveCanonicalLearningsPath(repoPath, 'evidence.jsonl');
  const mergedRecords = mergeEvidenceRecords(filePath, records)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((record) => ({
      ...record,
      sourcePath: evidenceSourcePath()
    }));

  const nextContent = mergedRecords
    .map((record) => `${JSON.stringify(serializeEvidenceRecord(record))}\n`)
    .join('');
  fs.writeFileSync(filePath, nextContent, 'utf8');

  return mergedRecords.map((record, index) => `${filePath}#L${index + 1}`);
}

/** Loads any existing JSONL at `filePath` into an id-keyed map, then upserts `records` on top. */
function mergeEvidenceRecords(
  filePath: string,
  records: EvidenceRecord[]
): EvidenceRecord[] {
  const byId = new Map<string, EvidenceRecord>();

  if (fs.existsSync(filePath)) {
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }

      const parsed = JSON.parse(line) as EvidenceRecord;
      byId.set(parsed.id, parsed);
    }
  }

  for (const record of records) {
    byId.set(record.id, record);
  }

  return [...byId.values()];
}

/** Constructs an `EvidenceRecord` from the first comment of a review thread; returns null if the thread has no comments. */
function buildThreadEvidenceRecord(
  repositoryId: string,
  payload: GitHubPullRequestEvidence,
  thread: GitHubReviewThreadEvidence,
  baseExternalId: string,
  now: string
): EvidenceRecord | null {
  const firstComment = thread.comments[0];
  if (!firstComment) {
    return null;
  }

  const threadId = thread.id ?? firstComment.id;
  const id = createDeterministicId('ev', `${baseExternalId}:thread:${threadId}`);
  const weight = weightReviewThread(thread);
  const author = inferAuthorFields(firstComment.author?.login);

  return {
    type: 'evidence',
    sourcePath: evidenceSourcePath(),
    id,
    repository_id: repositoryId,
    source_system: 'github',
    source_type: 'pr_review_thread',
    external_id: `${baseExternalId}:thread:${threadId}`,
    parent_external_id: baseExternalId,
    url: firstComment.url,
    pr_number: payload.pullRequest.number,
    thread_id: threadId,
    comment_id: String(firstComment.databaseId ?? firstComment.id),
    title: buildThreadTitle(firstComment.path, firstComment.line),
    content: firstComment.body.trim(),
    file_path: firstComment.path,
    line_start: firstComment.line,
    line_end: firstComment.line,
    resolution_state: thread.isResolved ? 'resolved' : 'unresolved',
    ...author,
    base_weight: weight.baseWeight,
    final_weight: weight.finalWeight,
    boosts: weight.boosts,
    penalties: weight.penalties,
    occurred_at: firstComment.createdAt,
    created_at: now,
    updated_at: now
  };
}

/** Assembles a human-readable summary of the PR (number + title + body + changed files) as the evidence content. */
function buildPullRequestSummaryBody(payload: GitHubPullRequestEvidence): string {
  const sections: string[] = [];
  sections.push(`PR #${payload.pullRequest.number}: ${payload.pullRequest.title}`);

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

/**
 * Produces a plain-object representation of an `EvidenceRecord` for JSON serialization.
 * Omits `type` and `sourcePath` (derived fields not stored in JSONL).
 */
function serializeEvidenceRecord(
  record: EvidenceRecord
): Record<string, unknown> {
  return {
    id: record.id,
    repository_id: record.repository_id,
    source_system: record.source_system,
    source_type: record.source_type,
    external_id: record.external_id,
    parent_external_id: record.parent_external_id,
    url: record.url,
    pr_number: record.pr_number,
    review_id: record.review_id,
    thread_id: record.thread_id,
    comment_id: record.comment_id,
    author_type: record.author_type,
    author_name: record.author_name,
    author_role: record.author_role,
    title: record.title,
    file_path: record.file_path,
    line_start: record.line_start,
    line_end: record.line_end,
    review_state: record.review_state,
    resolution_state: record.resolution_state,
    occurred_at: record.occurred_at,
    base_weight: record.base_weight,
    final_weight: record.final_weight,
    boosts: record.boosts,
    penalties: record.penalties,
    created_at: record.created_at,
    updated_at: record.updated_at,
    content: record.content.trim()
  };
}

/** Returns the canonical relative path for the evidence JSONL file (without a line number). */
function evidenceSourcePath(): string {
  return EVIDENCE_JSONL_RELATIVE_PATH;
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
