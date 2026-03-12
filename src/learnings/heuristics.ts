// Text and author classification helpers shared across weighting and extraction.
// These are pure functions with no I/O so they can be unit-tested in isolation.

/**
 * Returns true for text that carries no engineering signal worth extracting—
 * e.g. empty strings or comments that are purely stylistic nits or typo fixes.
 */
export function isLowSignalReviewText(text: string): boolean {
  const normalized = text.trim().toLowerCase();

  if (!normalized) {
    return true;
  }

  const lowSignalPrefixes = [
    'nit:',
    'nit ',
    'style:',
    'style ',
    'typo:',
    'typo '
  ];

  return lowSignalPrefixes.some((prefix) => normalized.startsWith(prefix));
}

/**
 * Detects whether a GitHub actor is a bot by matching well-known bot name patterns.
 * Returns `undefined` when no name is provided (anonymous author).
 */
export function classifyAuthorType(authorName?: string): string | undefined {
  if (!authorName) {
    return undefined;
  }

  return /(bot|github-actions|coderabbit(?:ai)?|copilot|assistant)/i.test(authorName)
    ? 'bot'
    : 'human';
}

/**
 * Maps a GitHub review state to a signal penalty list.
 * `COMMENTED` reviews lack an explicit verdict, so they get a `review_comment_only` penalty;
 * `APPROVED` and `CHANGES_REQUESTED` reviews carry no penalty here.
 */
export function inferReviewStatePenalty(state?: string): string[] {
  if (!state) {
    return [];
  }

  const normalized = state.toUpperCase();
  if (normalized === 'APPROVED') {
    return [];
  }

  if (normalized === 'COMMENTED') {
    return ['review_comment_only'];
  }

  return [];
}
