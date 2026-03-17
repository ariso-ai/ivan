// Stable, deterministic ID generation for learnings records.
// All IDs use a `{prefix}_{body}` convention so type can be inferred at a glance.

import { createHash } from 'crypto';

/** Pattern every record ID must match regardless of prefix. */
const GENERIC_ID_PATTERN = /^[a-z]{2,8}_[a-z0-9][a-z0-9_-]*$/;

/** Converts an arbitrary string to a lowercase, hyphen-separated slug safe for use in IDs and paths. */
export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

/** Returns `repo_{slug}` for the given repository name; throws if the name produces an empty slug. */
export function createRepositoryId(value: string): string {
  const slug = slugify(value);
  if (!slug) {
    throw new Error(
      'Repository name must contain at least one letter or digit'
    );
  }

  return `repo_${slug}`;
}

/**
 * Builds a stable `{prefix}_{20-hex-char SHA1}` ID from the given parts.
 * Parts are joined with the ASCII unit-separator (U+001F) before hashing so
 * order matters but separators cannot clash with part content.
 */
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

/** Returns true when `id` matches the `{prefix}_[a-z0-9][a-z0-9_-]*` pattern (or the generic 2–8-char prefix form). */
export function isStableRecordId(id: string, prefix?: string): boolean {
  if (prefix) {
    const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^${escapedPrefix}_[a-z0-9][a-z0-9_-]*$`).test(id);
  }

  return GENERIC_ID_PATTERN.test(id);
}
