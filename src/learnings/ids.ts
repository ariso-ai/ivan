import { createHash } from 'node:crypto';

const GENERIC_ID_PATTERN = /^[a-z]{2,8}_[a-z0-9][a-z0-9_-]*$/;

export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

export function createRepositoryId(value: string): string {
  const slug = slugify(value);
  if (!slug) {
    throw new Error(
      'Repository name must contain at least one letter or digit'
    );
  }

  return `repo_${slug}`;
}

export function createDeterministicId(
  prefix: string,
  ...parts: Array<string | undefined>
): string {
  const seed = parts.filter(Boolean).join('\u001f');
  if (!seed) {
    throw new Error('Deterministic IDs require at least one non-empty seed');
  }

  const digest = createHash('sha1').update(seed).digest('hex').slice(0, 20);
  return `${prefix}_${digest}`;
}

export function isStableRecordId(id: string, prefix?: string): boolean {
  if (prefix) {
    return new RegExp(`^${prefix}_[a-z0-9][a-z0-9_-]*$`).test(id);
  }

  return GENERIC_ID_PATTERN.test(id);
}
