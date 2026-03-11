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

export function classifyAuthorType(authorName?: string): string | undefined {
  if (!authorName) {
    return undefined;
  }

  return /(bot|github-actions|coderabbit(?:ai)?|copilot|assistant)/i.test(authorName)
    ? 'bot'
    : 'human';
}

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
