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

export interface EvidenceWeight {
  baseWeight: number;
  finalWeight: number;
  boosts: string[];
  penalties: string[];
}

export function weightIssueComment(
  comment: GitHubIssueCommentEvidence
): EvidenceWeight {
  return computeWeight(comment.body, {
    baseWeight: 3,
    boosts: [],
    penalties: []
  });
}

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

export function inferAuthorFields(authorName?: string): {
  author_type?: string;
  author_name?: string;
} {
  const result: { author_type?: string; author_name?: string } = {};
  const authorType = classifyAuthorType(authorName);
  if (authorType !== undefined) {
    result.author_type = authorType;
  }
  if (authorName !== undefined) {
    result.author_name = authorName;
  }
  return result;
}

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
