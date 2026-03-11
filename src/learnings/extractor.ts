import type { LearningsBuildResult } from './builder.js';
import { rebuildLearningsDatabase } from './builder.js';
import { createDeterministicId, slugify } from './id.js';
import { isLowSignalReviewText } from './heuristics.js';
import { writeLearningRecords } from './learning-writer.js';
import { loadCanonicalRecords } from './parser.js';
import type { EvidenceRecord, LearningRecord } from './record-types.js';
import {
  ensureLearningsDirectories,
  resolveLearningsRepositoryContext,
  writeRepositoryRecord
} from './repository.js';

export interface ExtractionResult {
  repositoryId: string;
  writtenLearningCount: number;
  writtenPaths: string[];
  rebuild: LearningsBuildResult;
}

export function extractLearningsFromEvidence(repoPath: string): ExtractionResult {
  const context = resolveLearningsRepositoryContext(repoPath);
  ensureLearningsDirectories(context);
  writeRepositoryRecord(context);

  const dataset = loadCanonicalRecords(context.repoPath);
  const extractedRecords = extractLearningRecords(dataset.evidence);
  const writtenPaths = writeLearningRecords(
    context.repoPath,
    context.repositoryId,
    extractedRecords
  );
  const rebuild = rebuildLearningsDatabase(context.repoPath);

  return {
    repositoryId: context.repositoryId,
    writtenLearningCount: extractedRecords.length,
    writtenPaths,
    rebuild
  };
}

export function extractLearningRecords(
  evidenceRecords: EvidenceRecord[]
): LearningRecord[] {
  const records = evidenceRecords
    .filter(shouldExtractEvidence)
    .map((evidence) => buildLearningRecord(evidence))
    .filter((record): record is LearningRecord => record !== null);

  return records.sort((left, right) => left.id.localeCompare(right.id));
}

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
    /\b(before rewrite|after rewrite|agent instructions)\b/i.test(evidence.content)
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

  return withOptionalFields<LearningRecord>({
    type: 'learning',
    sourcePath: `learnings/lessons/${evidence.repository_id}.jsonl`,
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
  }, {
    source_type: 'github_pr_discourse',
    title,
    rationale,
    applicability: inferApplicability(kind, evidence),
    confidence: inferConfidence(evidence.final_weight ?? evidence.base_weight ?? 0)
  });
}

function extractStatement(content: string): string | null {
  const emphasized = extractEmphasizedStatement(content);
  if (emphasized && isUsableCandidate(emphasized)) {
    return emphasized;
  }

  const normalized = sanitizeEvidenceContent(content);

  const candidates = normalized
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.?!])\s+/))
    .map((candidate) => candidate.trim())
    .filter((candidate) => isUsableCandidate(candidate));

  for (const candidate of candidates) {
    const imperative = toImperativeStatement(candidate);
    if (imperative) {
      return imperative;
    }
  }

  const fallback = candidates[0];
  if (!fallback) {
    return null;
  }

  return sentenceCase(fallback.replace(/[.?!]+$/, ''));
}

function extractPullRequestStatement(
  evidence: EvidenceRecord
): string | null {
  const content = sanitizeEvidenceContent(evidence.content);
  const candidates = content
    .split(/(?<=[.?!])\s+/)
    .map((candidate) => normalizeCandidateText(candidate))
    .filter((candidate) => isUsableCandidate(candidate));

  for (const candidate of candidates) {
    if (/^pr\s+\d+:/i.test(candidate)) {
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

function extractRationale(content: string, statement: string): string | undefined {
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

function inferLearningKind(
  evidence: EvidenceRecord,
  statement: string
): string {
  const haystack = `${statement} ${evidence.title ?? ''} ${evidence.file_path ?? ''}`.toLowerCase();

  if (
    /\b(ivan|claude|hook|prompt|cli|command|settings|github|repo|worktree)\b/.test(
      haystack
    )
  ) {
    return 'repo_convention';
  }

  return 'engineering_lesson';
}

function inferTitle(statement: string): string | undefined {
  const trimmed = statement.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed.length <= 72 ? trimmed : `${trimmed.slice(0, 69).trimEnd()}...`;
}

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

function inferConfidence(weight: number): number {
  const confidence = 0.35 + Math.min(weight, 12) / 20;
  return Math.max(0.35, Math.min(0.95, Number(confidence.toFixed(2))));
}

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
    [/^this is a bit odd,?\s+we shouldn't have\s+(.+)$/i, (match) => `Do not have ${match[1]}`],
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

function sentenceCase(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }

  return `${trimmed[0].toUpperCase()}${trimmed.slice(1)}`;
}

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
    .replace(/\[[^\]]+\]\([^)]+\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractEmphasizedStatement(content: string): string | null {
  const matches = content.matchAll(/\*\*([^*]+)\*\*/g);
  for (const match of matches) {
    const candidate = sentenceCase(
      normalizeCandidateText(match[1]).replace(/[.?!]+$/, '').trim()
    );
    if (isUsableCandidate(candidate)) {
      return candidate;
    }
  }

  return null;
}

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

function trimRationale(value: string): string | undefined {
  const trimmed = value
    .replace(/\b(Reviews paused|Walkthrough|Thanks for using)\b[\s\S]*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  return trimmed || undefined;
}

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

function withOptionalFields<T extends object>(
  base: T,
  optionalFields: Record<string, unknown>
): T {
  const result: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(optionalFields)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }

  return result as T;
}
