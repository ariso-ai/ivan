// Signal-strength scoring for each GitHub evidence type.
// Higher `finalWeight` means the evidence is more likely to contain a learning worth extracting.
// Weights feed directly into `shouldExtractEvidence` (threshold: 3) and `inferConfidence`.

import type {
  GitHubCheckEvidence,
  GitHubIssueCommentEvidence,
  GitHubReviewEvidence,
  GitHubReviewThreadEvidence
} from './github-evidence.js';
import {
  classifyAuthorType,
  inferReviewStatePenalty,
  isLowSignalReviewText
} from './heuristics.js';

/** The computed signal strength for a single piece of evidence, with audit trail labels. */
export interface EvidenceWeight {
  baseWeight: number;
  finalWeight: number;
  /** Labels that raised the signal (e.g. `changes_requested`, `unresolved_thread`). */
  boosts: string[];
  /** Labels that reduced the signal (e.g. `low_signal_text`, `outdated_thread`). */
  penalties: string[];
}

/** Scores a plain PR issue comment; base weight 3 before text-quality adjustment. */
export function weightIssueComment(
  comment: GitHubIssueCommentEvidence
): EvidenceWeight {
  return computeWeight(comment.body, {
    baseWeight: 3,
    boosts: [],
    penalties: []
  });
}

/**
 * Scores a PR review.  `CHANGES_REQUESTED` starts at 6 (actionable feedback);
 * other states start at 2.  Low-signal text reduces either by 2.
 */
export function weightReview(review: GitHubReviewEvidence): EvidenceWeight {
  const boosts: string[] = [];
  const penalties = inferReviewStatePenalty(review.state);

  if (review.state.toUpperCase() === 'CHANGES_REQUESTED') {
    boosts.push('changes_requested');
  }

  if (review.state.toUpperCase() === 'APPROVED') {
    boosts.push('approved');
  }

  return computeWeight(review.body, {
    baseWeight: review.state.toUpperCase() === 'CHANGES_REQUESTED' ? 6 : 2,
    boosts,
    penalties
  });
}

/**
 * Scores a review thread.  Unresolved threads start at 5 (still open issue),
 * resolved at 3.  Inline code comments get a boost; outdated threads get a penalty.
 */
export function weightReviewThread(
  thread: GitHubReviewThreadEvidence
): EvidenceWeight {
  const firstComment = thread.comments[0];
  const boosts: string[] = [];
  const penalties: string[] = [];

  if (!thread.isResolved) {
    boosts.push('unresolved_thread');
  }

  if (thread.isOutdated) {
    penalties.push('outdated_thread');
  }

  if (firstComment?.path) {
    boosts.push('inline_code_comment');
  }

  return computeWeight(firstComment?.body ?? '', {
    baseWeight: thread.isResolved ? 3 : 5,
    boosts,
    penalties
  });
}

/**
 * Scores a CI check.  Failures/errors are high-signal (weight 4); passing checks
 * are low-signal (weight 1) and bypass the text-quality computation entirely.
 */
export function weightCheck(check: GitHubCheckEvidence): EvidenceWeight {
  const normalizedState = check.state.toUpperCase();

  if (normalizedState === 'FAILURE' || normalizedState === 'ERROR') {
    return {
      baseWeight: 4,
      finalWeight: 4,
      boosts: ['failing_check'],
      penalties: []
    };
  }

  return {
    baseWeight: 1,
    finalWeight: 1,
    boosts: ['non_failing_check'],
    penalties: []
  };
}

/** Wraps `classifyAuthorType` into the `{ author_type, author_name }` shape expected by `EvidenceRecord`. */
export function inferAuthorFields(authorName?: string): {
  author_type?: string;
  author_name?: string;
} {
  return {
    author_type: classifyAuthorType(authorName),
    author_name: authorName
  };
}

/**
 * Applies text-quality adjustment on top of a seed weight.
 * Low-signal text (nit/style/typo prefixes) subtracts 2, floored at 0.
 */
function computeWeight(
  text: string,
  seed: { baseWeight: number; boosts: string[]; penalties: string[] }
): EvidenceWeight {
  const boosts = [...seed.boosts];
  const penalties = [...seed.penalties];
  let finalWeight = seed.baseWeight;

  if (isLowSignalReviewText(text)) {
    penalties.push('low_signal_text');
    finalWeight -= 2;
  }

  if (finalWeight < 0) {
    finalWeight = 0;
  }

  return {
    baseWeight: seed.baseWeight,
    finalWeight,
    boosts,
    penalties
  };
}
