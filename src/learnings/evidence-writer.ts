import { Effect } from 'effect';
import { createDeterministicId } from './id.js';
import type { EvidenceRecord } from './record-types.js';
import type {
  GitHubPullRequestEvidence,
  GitHubReviewThreadEvidence
} from './github-evidence.js';
import { CanonicalStore } from './canonical-store.js';
import { runLearningsEffect } from './run-effect.js';
import {
  inferAuthorFields,
  weightCheck,
  weightIssueComment,
  weightReview,
  weightReviewThread
} from './weighting.js';

export function buildEvidenceRecordsFromPullRequest(
  repositoryId: string,
  payload: GitHubPullRequestEvidence
): EvidenceRecord[] {
  const records: EvidenceRecord[] = [];
  const now = new Date().toISOString();
  const baseExternalId = `github:${payload.repository.owner}/${payload.repository.name}:pr:${payload.pullRequest.number}`;

  records.push({
    type: 'evidence',
    sourcePath: evidenceSourcePath(repositoryId),
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
    const id = createDeterministicId(
      'ev',
      `${baseExternalId}:issue-comment:${comment.id}`
    );
    const weight = weightIssueComment(comment);
    const author = inferAuthorFields(comment.author?.login);
    records.push({
      type: 'evidence',
      sourcePath: evidenceSourcePath(repositoryId),
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
    const id = createDeterministicId(
      'ev',
      `${baseExternalId}:review:${review.id}`
    );
    const weight = weightReview(review);
    const author = inferAuthorFields(review.author?.login);
    records.push({
      type: 'evidence',
      sourcePath: evidenceSourcePath(repositoryId),
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
    const id = createDeterministicId(
      'ev',
      `${baseExternalId}:check:${check.name}:${check.state}`
    );
    const weight = weightCheck(check);
    records.push({
      type: 'evidence',
      sourcePath: evidenceSourcePath(repositoryId),
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

  return records.sort((left, right) => left.id.localeCompare(right.id));
}

export function writeEvidenceRecords(
  repoPath: string,
  repositoryId: string,
  records: EvidenceRecord[]
): Promise<string[]> {
  return runLearningsEffect(
    Effect.gen(function* () {
      const store = yield* CanonicalStore;
      const written = yield* store.writeEvidence(
        repoPath,
        repositoryId,
        records
      );
      return [...written];
    })
  );
}

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
  const id = createDeterministicId(
    'ev',
    `${baseExternalId}:thread:${threadId}`
  );
  const weight = weightReviewThread(thread);
  const author = inferAuthorFields(firstComment.author?.login);

  return {
    type: 'evidence',
    sourcePath: evidenceSourcePath(repositoryId),
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

function evidenceSourcePath(repositoryId: string): string {
  return `learnings/evidence/${repositoryId}.jsonl`;
}

function buildThreadTitle(filePath?: string, line?: number): string {
  if (!filePath) {
    return 'Review thread';
  }

  if (line === undefined) {
    return `Review thread on ${filePath}`;
  }

  return `Review thread on ${filePath}:${line}`;
}
