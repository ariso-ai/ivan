// Converts raw evidence records into actionable learning records using NLP heuristics.
// The extraction pipeline: filter low-signal evidence → distill an imperative statement
// → infer kind/title/tags/confidence → write JSONL → rebuild the SQLite index.

import type { LearningsBuildResult } from './builder.js';
import { rebuildLearningsDatabase } from './builder.js';
import { createDeterministicId, slugify } from './id.js';
import { isLowSignalReviewText } from './heuristics.js';
import { writeLearningRecords } from './learning-writer.js';
import { LESSONS_JSONL_RELATIVE_PATH } from './paths.js';
import { loadCanonicalRecords } from './parser.js';
import type { EvidenceRecord, LearningRecord } from './record-types.js';
import {
  ensureLearningsDirectories,
  resolveLearningsRepositoryContext
} from './repository.js';

/** Returned by `extractLearningsFromEvidence`; summarises what was written and the rebuild outcome. */
export interface ExtractionResult {
  repositoryId: string;
  writtenLearningCount: number;
  writtenPaths: string[];
  rebuild: LearningsBuildResult;
}

/**
 * Top-level orchestrator: ensures the repo is initialised, runs extraction over all
 * evidence records, writes the resulting learnings to JSONL, and rebuilds the SQLite DB.
 */
export async function extractLearningsFromEvidence(
  repoPath: string
): Promise<ExtractionResult> {
  const context = resolveLearningsRepositoryContext(repoPath);
  ensureLearningsDirectories(context);

  const dataset = loadCanonicalRecords(context.repoPath);
  const extractedRecords = extractLearningRecords(dataset.evidence);
  const writtenPaths = writeLearningRecords(
    context.repoPath,
    context.repositoryId,
    extractedRecords
  );
  const rebuild = await rebuildLearningsDatabase(context.repoPath);

  return {
    repositoryId: context.repositoryId,
    writtenLearningCount: extractedRecords.length,
    writtenPaths,
    rebuild
  };
}

/**
 * Filters evidence through `shouldExtractEvidence`, maps each survivor to a `LearningRecord`,
 * drops nulls, and returns records sorted by id for deterministic JSONL output.
 */
export function extractLearningRecords(
  evidenceRecords: EvidenceRecord[]
): LearningRecord[] {
  const records = evidenceRecords
    .filter(shouldExtractEvidence)
    .map((evidence) => buildLearningRecord(evidence))
    .filter((record): record is LearningRecord => record !== null);

  return records.sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * Returns false for evidence that should not produce a learning: bot authors,
 * CI checks, auto-generated comments, weight below 3, or low-signal text.
 */
function shouldExtractEvidence(evidence: EvidenceRecord): boolean {
  if (
    evidence.author_type === 'bot' ||
    /(coderabbit(?:ai)?|copilot|assistant|github-actions)/i.test(
      evidence.author_name ?? ''
    )
  ) {
    return false;
  }

  if (evidence.source_type === 'pr_check') {
    return false;
  }

  if (
    evidence.source_type === 'pr_issue_comment' &&
    /\b(before rewrite|after rewrite|agent instructions)\b/i.test(
      evidence.content
    )
  ) {
    return false;
  }

  if (
    /\b(auto-generated comment|reviews paused|walkthrough|pre-merge checks|finishing touches)\b/i.test(
      evidence.content
    )
  ) {
    return false;
  }

  if ((evidence.final_weight ?? 0) < 3) {
    return false;
  }

  if (evidence.penalties.includes('low_signal_text')) {
    return false;
  }

  if (isLowSignalReviewText(evidence.content)) {
    return false;
  }

  return true;
}

/**
 * Constructs a `LearningRecord` from a single evidence item; returns null if no
 * usable statement can be extracted (the record is silently dropped).
 */
function buildLearningRecord(evidence: EvidenceRecord): LearningRecord | null {
  const statement =
    evidence.source_type === 'pull_request'
      ? extractPullRequestStatement(evidence)
      : extractStatement(evidence.content);
  if (!statement) {
    return null;
  }

  const rationale = extractRationale(evidence.content, statement);
  const kind = inferLearningKind(evidence, statement);
  const evidenceIds = [evidence.id];
  const now = evidence.updated_at;
  const title = inferTitle(statement);

  return withOptionalFields<LearningRecord>(
    {
      type: 'learning',
      sourcePath: LESSONS_JSONL_RELATIVE_PATH,
      id: createDeterministicId(
        'lrn',
        evidence.repository_id,
        evidence.id,
        statement
      ),
      repository_id: evidence.repository_id,
      kind,
      statement,
      status: 'active',
      evidence_ids: evidenceIds,
      tags: inferTags(statement, evidence),
      created_at: now,
      updated_at: now
    },
    {
      source_type: 'github_pr_discourse',
      title,
      rationale,
      applicability: inferApplicability(kind, evidence),
      confidence: inferConfidence(
        evidence.final_weight ?? evidence.base_weight ?? 0
      )
    }
  );
}

/**
 * Attempts to distil one actionable statement from free-form review text.
 * Priority order: bold-emphasized text → imperative sentence → first usable sentence.
 */
function extractStatement(content: string): string | null {
  const emphasized = extractEmphasizedStatement(content);
  if (emphasized && isUsableCandidate(emphasized)) {
    return emphasized;
  }

  const normalized = sanitizeEvidenceContent(content);

  const allCandidates = normalized
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.?!])\s+/))
    .map((candidate) => candidate.trim());

  const candidates = allCandidates.filter((candidate) =>
    isUsableCandidate(candidate)
  );

  for (const candidate of candidates) {
    const imperative = toImperativeStatement(candidate);
    if (imperative) {
      return imperative;
    }
  }

  // Question-form candidates are rejected by isUsableCandidate, but toImperativeStatement
  // may be able to rewrite them into actionable imperatives — try those before giving up.
  for (const candidate of allCandidates) {
    if (isUsableCandidate(candidate)) {
      continue;
    }
    if (
      /^(who|what|when|where|why|how)\b/i.test(candidate) ||
      candidate.endsWith('?')
    ) {
      const imperative = toImperativeStatement(candidate);
      if (imperative) {
        return imperative;
      }
    }
  }

  const fallback = candidates[0];
  if (!fallback) {
    return null;
  }

  return sentenceCase(fallback.replace(/[.?!]+$/, ''));
}

/**
 * Specialised statement extractor for `pull_request`-type evidence.
 * Skips PR-prefix lines and "verify/changed files" boilerplate before picking the first usable sentence.
 */
function extractPullRequestStatement(evidence: EvidenceRecord): string | null {
  const candidates = evidence.content
    .split(/\n+/)
    .flatMap((line) => sanitizeEvidenceContent(line).split(/(?<=[.?!])\s+/))
    .map((candidate) => normalizeCandidateText(candidate))
    .filter((candidate) => isUsableCandidate(candidate));

  for (const candidate of candidates) {
    if (/^pr\s*#?\s*\d+:/i.test(candidate)) {
      continue;
    }

    if (/^(verify|changed files)\b/i.test(candidate)) {
      continue;
    }

    return sentenceCase(candidate.replace(/[.?!]+$/, ''));
  }

  const title = evidence.title?.trim();
  return title ? sentenceCase(title.replace(/[.?!]+$/, '')) : null;
}

/**
 * Returns the text that follows the statement within the evidence content as the rationale.
 * Falls back to the full normalized content when the statement does not appear at the start.
 */
function extractRationale(
  content: string,
  statement: string
): string | undefined {
  const normalizedContent = sanitizeEvidenceContent(content);
  if (!normalizedContent) {
    return undefined;
  }

  const normalizedStatement = statement.replace(/[.?!]+$/, '').trim();
  const trimmedContent = normalizedContent.replace(/\s+/g, ' ');
  if (trimmedContent.startsWith(normalizedStatement)) {
    const remainder = trimmedContent.slice(normalizedStatement.length).trim();
    if (remainder) {
      return sentenceCase(remainder.replace(/^[.?!:\-\s]+/, ''));
    }
  }

  if (trimmedContent !== statement) {
    return trimRationale(normalizedContent);
  }

  return undefined;
}

/**
 * Returns `repo_convention` when the statement or metadata references ivan/Claude/hooks/CLI,
 * otherwise `engineering_lesson` for broadly applicable patterns.
 */
function inferLearningKind(
  evidence: EvidenceRecord,
  statement: string
): string {
  const haystack =
    `${statement} ${evidence.title ?? ''} ${evidence.file_path ?? ''}`.toLowerCase();

  if (
    /\b(ivan|claude|hook|prompt|cli|command|settings|github|repo|worktree)\b/.test(
      haystack
    )
  ) {
    return 'repo_convention';
  }

  return 'engineering_lesson';
}

/** Truncates the statement to 72 chars (with `...`) for use as a short display title. */
function inferTitle(statement: string): string | undefined {
  const trimmed = statement.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed.length <= 72
    ? trimmed
    : `${trimmed.slice(0, 69).trimEnd()}...`;
}

/** Produces a one-sentence applicability hint based on kind and whether the evidence has a file path. */
function inferApplicability(
  kind: string,
  evidence: EvidenceRecord
): string | undefined {
  if (kind === 'repo_convention') {
    return 'Use this in this repository’s CLI, Claude Code, hook, and automation paths.';
  }

  if (evidence.file_path?.includes('src/')) {
    return 'Use this in similar code paths when changing implementation logic in this repository.';
  }

  return 'Use this when similar implementation or review patterns show up again.';
}

/** Maps a `final_weight` (0–12+) to a confidence score in [0.35, 0.95] using a linear scale. */
function inferConfidence(weight: number): number {
  const confidence = 0.35 + Math.min(weight, 12) / 20;
  return Math.max(0.35, Math.min(0.95, Number(confidence.toFixed(2))));
}

/**
 * Assigns topic tags by matching the statement and file path against keyword patterns.
 * Falls back to a slugified `source_type` when no pattern matches.
 */
function inferTags(statement: string, evidence: EvidenceRecord): string[] {
  const source = `${statement} ${evidence.file_path ?? ''}`.toLowerCase();
  const tags = new Set<string>();

  const tagRules: Array<[RegExp, string]> = [
    [/\bcli\b|\bcommand\b|\bprompt\b/, 'cli'],
    [/\bclaude\b|\bhook\b/, 'claude'],
    [/\basync\b|\bawait\b/, 'async'],
    [/\block\b|\bdeadlock\b|\bconcurr/, 'concurrency'],
    [/\btest\b|\bfixture\b/, 'testing'],
    [/\bgithub\b|\bpr\b|\breview\b/, 'github'],
    [/\bconfig\b|\bsettings\b/, 'configuration'],
    [/\bparser\b|\bparsing\b|\bflag\b/, 'parsing']
  ];

  for (const [pattern, tag] of tagRules) {
    if (pattern.test(source)) {
      tags.add(tag);
    }
  }

  if (tags.size === 0) {
    tags.add(slugify(evidence.source_type).replace(/-/g, '_'));
  }

  return [...tags].sort((left, right) => left.localeCompare(right));
}

/**
 * Attempts to rewrite a natural-language sentence into an imperative ("Avoid X", "Use Y") form.
 * Uses 20+ regex patterns covering common review phrasings; returns null if no pattern matches
 * or the candidate is a single word.
 */
function toImperativeStatement(candidate: string): string | null {
  const normalized = normalizeCandidateText(candidate)
    .replace(/^[*\-\d.\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.?!]+$/, '');

  if (!normalized) {
    return null;
  }

  const patterns: Array<[RegExp, (match: RegExpExecArray) => string]> = [
    [/\b(avoid\b.+)$/i, (match) => match[1]],
    [/\b(prefer\b.+)$/i, (match) => match[1]],
    [/\b(keep\b.+)$/i, (match) => match[1]],
    [/\b(use\b.+)$/i, (match) => match[1]],
    [/\b(pass\b.+)$/i, (match) => match[1]],
    [/\b(release\b.+)$/i, (match) => match[1]],
    [/\b(ensure\b.+)$/i, (match) => match[1]],
    [/\b(do not\b.+)$/i, (match) => match[1]],
    [/\b(don't\b.+)$/i, (match) => match[1]],
    [/^i(?:'d| would)? recommend\s+(.+)$/i, (match) => match[1]],
    [
      /^i think\s+(.+?)\s+would be nice(?:\s+(.+))?$/i,
      (match) => {
        const tail = match[2]?.trim();
        const core = tail ? `${match[1]} ${tail}` : match[1];
        return `Consider ${core}.`;
      }
    ],
    [/^i think\s+(.+)$/i, (match) => match[1]],
    [
      /^btw\s+i moved this here because\s+(.+)$/i,
      (match) => `Keep this here because ${match[1]}`
    ],
    [
      /^this is a bit odd,?\s+we shouldn't have\s+(.+)$/i,
      (match) => `Do not have ${match[1]}`
    ],
    [/^also fixes?\s+(.+)$/i, (match) => match[1]],
    [/^needs to\s+(.+)$/i, (match) => match[1]],
    [/^need to\s+(.+)$/i, (match) => match[1]],
    [/^can we\s+(.+)$/i, (match) => match[1]],
    [/^good catch[,.:]?\s+(.+)$/i, (match) => match[1]]
  ];

  for (const [pattern, resolver] of patterns) {
    const match = pattern.exec(normalized);
    if (match) {
      return sentenceCase(resolver(match));
    }
  }

  return normalized.includes(' ') ? sentenceCase(normalized) : null;
}

/** Uppercases the first character of a trimmed string; a no-op on empty input. */
function sentenceCase(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }

  return `${trimmed[0].toUpperCase()}${trimmed.slice(1)}`;
}

/**
 * Strips HTML, Markdown structural noise, code fences, and bot-generated boilerplate
 * from evidence text, leaving only the human-readable prose for statement extraction.
 */
function sanitizeEvidenceContent(content: string): string {
  return content
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<details>[\s\S]*?<\/details>/gi, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[!NOTE\]/gi, ' ')
    .replace(/\b(CodeRabbit|Copilot)\b/gi, ' ')
    .replace(/\bActionable comments posted:.*$/gim, ' ')
    .replace(/\bReviews paused\b.*$/gim, ' ')
    .replace(/\bWalkthrough\b.*$/gim, ' ')
    .replace(/\bThanks for using\b.*$/gim, ' ')
    .replace(/\bBefore Rewrite:\b/gi, ' ')
    .replace(/\bAfter Rewrite:\b/gi, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[*_>#]+/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Returns the first `**bold**` span that passes `isUsableCandidate`, or null if none found. */
function extractEmphasizedStatement(content: string): string | null {
  const matches = content.matchAll(/\*\*([^*]+)\*\*/g);
  for (const match of matches) {
    const candidate = sentenceCase(
      normalizeCandidateText(match[1])
        .replace(/[.?!]+$/, '')
        .trim()
    );
    if (isUsableCandidate(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Gate that rejects candidates too short, bot-generated, question-starting, or matching
 * known boilerplate patterns (walkthrough, action items, rewrite headers, etc.).
 */
function isUsableCandidate(candidate: string): boolean {
  if (!candidate) {
    return false;
  }

  const normalized = normalizeCandidateText(candidate)
    .replace(/\s+/g, ' ')
    .replace(/[|:]+/g, ' ')
    .trim();

  if (/^(_|<!--|details|summary)/i.test(candidate)) {
    return false;
  }

  if (/^(trivial|minor|major|critical|commented)$/i.test(candidate)) {
    return false;
  }

  if (normalized.length < 8) {
    return false;
  }

  if (
    /\b(important|nitpick|trivial|minor|major|critical|potential issue|reviews paused|walkthrough|actionable comments posted|thanks for using|before rewrite|after rewrite)\b/i.test(
      normalized
    )
  ) {
    return false;
  }

  if (/^(verify (build|db)|changed files)\b/i.test(normalized)) {
    return false;
  }

  if (/^(why|what|how|can|could|should)\b/i.test(normalized)) {
    return false;
  }

  if (
    /\b(coderabbit|copilot|auto-generated comment|resume reviews|trigger review)\b/i.test(
      normalized
    )
  ) {
    return false;
  }

  if (/^pr\s+\d+:/i.test(normalized) && normalized.length < 40) {
    return false;
  }

  return true;
}

/** Strips bot-generated tail sections (walkthrough, reviews paused, etc.) from a rationale string. */
function trimRationale(value: string): string | undefined {
  const trimmed = value
    .replace(/\b(Reviews paused|Walkthrough|Thanks for using)\b[\s\S]*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  return trimmed || undefined;
}

/** Strips leading severity labels (nitpick/minor/major/critical) and emoji from a candidate string. */
function normalizeCandidateText(value: string): string {
  return value
    .replace(
      /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]*\b(?:nitpick|potential issue|style|typo)\b\s*\|\s*[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]*\b(?:trivial|minor|major|critical)\b\s*/iu,
      ''
    )
    .replace(
      /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]*\b(?:trivial|minor|major|critical)\b[:\s-]*/iu,
      ''
    )
    .replace(/^\s*minor:\s*/i, '')
    .replace(/^\s*critical:\s*/i, '')
    .replace(/^\s*major:\s*/i, '')
    .replace(/^\s*trivial:\s*/i, '')
    .trim();
}

/** Merges `optionalFields` into `base`, skipping keys whose value is `undefined`. */
function withOptionalFields<T extends object>(
  base: T,
  optionalFields: Record<string, unknown>
): T {
  const result = { ...base } as Record<string, unknown>;

  for (const [key, value] of Object.entries(optionalFields)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }

  return result as T;
}
