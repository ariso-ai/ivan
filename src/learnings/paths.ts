import path from 'path';

export const CANONICAL_LEARNINGS_ROOT = '.ivan';
export const EVIDENCE_JSONL_RELATIVE_PATH = `${CANONICAL_LEARNINGS_ROOT}/evidence.jsonl`;
export const LESSONS_JSONL_RELATIVE_PATH = `${CANONICAL_LEARNINGS_ROOT}/lessons.jsonl`;
export const LEARNINGS_DB_RELATIVE_PATH = `${CANONICAL_LEARNINGS_ROOT}/db.sqlite`;

export function canonicalLearningsPath(...segments: string[]): string {
  return path.posix.join(CANONICAL_LEARNINGS_ROOT, ...segments);
}

export function resolveCanonicalLearningsPath(
  repoPath: string,
  ...segments: string[]
): string {
  return path.join(path.resolve(repoPath), '.ivan', ...segments);
}
