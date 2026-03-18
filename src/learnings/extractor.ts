// Converts raw evidence signals into actionable learning records via LLM extraction.
// Pipeline: cheap pre-filter gates -> batch to GPT-4o-mini -> parse structured JSON output.

import OpenAI from 'openai';
import type { LearningsBuildResult } from './builder.js';
import { rebuildLearningsDatabase } from './builder.js';
import { createDeterministicId } from './id.js';
import { writeLearningRecords } from './learning-writer.js';
import { LESSONS_JSONL_RELATIVE_PATH } from './paths.js';
import { loadCanonicalRecords } from './parser.js';
import type {
  EvidenceSignal,
  EvidenceContextCache,
  LearningRecord
} from './record-types.js';
import {
  ensureLearningsDirectories,
  resolveLearningsRepositoryContext
} from './repository.js';
import { fetchGitHubPullRequestEvidence } from './github-evidence.js';
import { buildEvidenceSignalsFromPullRequest } from './evidence-writer.js';

export interface ExtractionResult {
  writtenLearningCount: number;
  writtenPaths: string[];
  rebuild: LearningsBuildResult;
}

const BATCH_SIZE = 15;

/**
 * JSON Schema passed to OpenAI structured outputs (strict: true).
 * The model is constrained to emit exactly this shape -- no runtime type-guards needed below.
 * rationale / applicability are nullable so the model can omit them cleanly.
 */
const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          evidence_id: { type: 'string' },
          lesson: {
            anyOf: [
              { type: 'null' },
              {
                type: 'object',
                properties: {
                  statement:    { type: 'string' },
                  kind:         { type: 'string', enum: ['repo_convention', 'engineering_lesson'] },
                  tags:         { type: 'array', items: { type: 'string' } },
                  confidence:   { type: 'number' },
                  rationale:    { anyOf: [{ type: 'null' }, { type: 'string' }] },
                  applicability:{ anyOf: [{ type: 'null' }, { type: 'string' }] }
                },
                required: ['statement', 'kind', 'tags', 'confidence', 'rationale', 'applicability'],
                additionalProperties: false
              }
            ]
          }
        },
        required: ['evidence_id', 'lesson'],
        additionalProperties: false
      }
    }
  },
  required: ['items'],
  additionalProperties: false
} as const;

interface LessonOutput {
  statement: string;
  kind: 'repo_convention' | 'engineering_lesson';
  tags: string[];
  confidence: number;
  rationale: string | null;
  applicability: string | null;
}

interface LessonItem {
  evidence_id: string;
  lesson: LessonOutput | null;
}

interface ExtractionResponse {
  items: LessonItem[];
}

const EXTRACTION_SYSTEM_PROMPT = `\
You are an expert at extracting actionable engineering lessons from GitHub PR review feedback.

For each piece of evidence, determine if it contains a reusable engineering lesson worth preserving.
If yes, distill it into a single imperative statement. If no, output null.

## Rewriting guidelines

Transform common review phrasings into clear imperatives:

| Input pattern                                        | Output form                       |
|------------------------------------------------------|-----------------------------------|
| "I think X would be nice [as we Y]"                  | "Consider X [as we Y]"            |
| "I recommend X" / "I'd recommend X"                  | X                                 |
| "I think X"                                          | X                                 |
| "Can we X?" / "Could we X?"                          | X                                 |
| "Needs to X" / "Need to X"                           | X                                 |
| "avoid X" / "prefer X" / "use X" / "ensure X"       | keep as-is (already imperative)   |
| "btw I moved this here because Y"                    | "Keep this here because Y"        |
| "This is a bit odd, we shouldn't have X"             | "Do not have X"                   |
| "Also fixes X" / "Good catch, X"                     | X                                 |

If the evidence contains **bold-emphasized** text, prefer that as the statement before extracting from prose.
Write statements in sentence case (capitalise the first word only).

## Return null for

- Bot boilerplate: walkthrough summaries, "Actionable comments posted:", "Reviews paused", "Thanks for using CodeRabbit"
- PR metadata lines: "PR #42:", "Before Rewrite:", "After Rewrite:", "Verify DB after...", "Changed files:"
- Content under 8 words or consisting of a single severity label (Minor, Major, Nitpick, Trivial, Critical)
- Pure questions with no extractable answer
- Content that only corrects formatting, whitespace, or spelling
- Auto-generated checklist items

## Classification (kind)

"repo_convention" -- statement references project-specific tools or patterns:
  ivan, claude, hook, prompt, CLI, command, settings, GitHub workflow, worktree

"engineering_lesson" -- general software engineering patterns applicable beyond this repo.

## Tags

Pick one or more from: cli, claude, async, concurrency, testing, github, configuration, parsing
Match tags to the semantic content of the statement. Use multiple tags when appropriate.

## Confidence

Derive from the provided weight (integer 1-12); clamp result to [0.35, 0.95]:
  weight 6+ -> 0.85-0.95
  weight 4-5 -> 0.65-0.80
  weight 3   -> 0.50-0.60

Return one item per evidence item in the same order as the input.
Set lesson to null when the evidence is not worth a lesson.
Set rationale and applicability to null when not applicable.

Some evidence items include a "diff context" block showing the code change being discussed.
Use this context to understand what specific code pattern the reviewer is commenting on.`;

/**
 * Extracts actionable learning records from evidence via the OpenAI API.
 * Holds the OpenAI client as an instance field, following the codebase's
 * class-based service pattern (matching PromptRewriter, OpenAIService, etc.).
 */
export class LearningsExtractor {
  private client: OpenAI | null = null;

  private getClient(): OpenAI {
    if (!this.client) this.client = new OpenAI();
    return this.client;
  }

  /**
   * Runs the full extract pipeline for a repo: loads evidence, calls the LLM,
   * writes learning records to JSONL, and rebuilds the SQLite index.
   */
  async extractLearningsFromEvidence(
    repoPath: string,
    contextCache?: EvidenceContextCache
  ): Promise<ExtractionResult> {
    const context = resolveLearningsRepositoryContext(repoPath);
    ensureLearningsDirectories(context);

    const dataset = loadCanonicalRecords(context.repoPath);
    const resolvedCache = contextCache ?? await refetchContextCache(context.repoPath, dataset.evidence);
    const extractedRecords = await this.extractLearningRecords(dataset.evidence, resolvedCache);
    const writtenPaths = writeLearningRecords(context.repoPath, extractedRecords);
    const rebuild = await rebuildLearningsDatabase(context.repoPath);

    return {
      writtenLearningCount: extractedRecords.length,
      writtenPaths,
      rebuild
    };
  }

  /**
   * Pre-filters evidence through cheap gates, then batches survivors to the LLM.
   * Returns records sorted by id for deterministic JSONL output.
   */
  async extractLearningRecords(
    signals: EvidenceSignal[],
    contextCache: EvidenceContextCache
  ): Promise<LearningRecord[]> {
    const eligible = signals.filter(isEligibleForExtraction);
    if (eligible.length === 0) return [];

    const all: LearningRecord[] = [];
    for (let i = 0; i < eligible.length; i += BATCH_SIZE) {
      const batch = eligible.slice(i, i + BATCH_SIZE);
      all.push(...(await this.extractBatch(batch, contextCache)));
    }

    return all.sort((a, b) => a.id.localeCompare(b.id));
  }

  private async extractBatch(
    batch: EvidenceSignal[],
    contextCache: EvidenceContextCache
  ): Promise<LearningRecord[]> {
    const userContent = batch
      .map((signal, i) => {
        const ctx = contextCache.get(signal.id);
        return [
          `## Evidence ${i + 1}`,
          `evidence_id: ${signal.id}`,
          `source_type: ${signal.source_type}`,
          `weight: ${signal.final_weight ?? signal.base_weight ?? 0}`,
          `author: ${signal.author_name ?? 'unknown'}`,
          ctx?.title != null ? `title: ${ctx.title}` : null,
          ctx?.file_path != null ? `file: ${ctx.file_path}` : null,
          ctx?.diff_hunk != null ? `\ndiff context:\n\`\`\`\n${ctx.diff_hunk}\n\`\`\`` : null,
          ctx?.content != null ? `\n${ctx.content}` : '\n[content unavailable]'
        ]
          .filter(Boolean)
          .join('\n');
      })
      .join('\n\n---\n\n');

    const response = await this.getClient().chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'lesson_extraction', strict: true, schema: EXTRACTION_SCHEMA }
      },
      messages: [
        { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
        { role: 'user', content: userContent }
      ]
    });

    let extraction: ExtractionResponse;
    try {
      extraction = JSON.parse(response.choices[0]?.message?.content ?? '{"items":[]}') as ExtractionResponse;
    } catch {
      return [];
    }

    const now = new Date().toISOString();
    const results: LearningRecord[] = [];

    for (const item of extraction.items) {
      if (!item.lesson) continue;

      const evidence = batch.find((ev) => ev.id === item.evidence_id);
      if (!evidence) continue;

      const { statement, kind, tags, confidence, rationale, applicability } = item.lesson;
      const trimmed = statement.trim();
      if (trimmed.length < 4) continue;

      results.push({
        type: 'learning',
        sourcePath: LESSONS_JSONL_RELATIVE_PATH,
        id: createDeterministicId('lrn', evidence.id, trimmed),
        kind,
        source_type: 'github_pr_discourse',
        statement: trimmed,
        title: trimmed.length <= 72 ? trimmed : `${trimmed.slice(0, 69).trimEnd()}...`,
        ...(rationale !== null ? { rationale } : {}),
        ...(applicability !== null ? { applicability } : {}),
        confidence: Math.max(0.35, Math.min(0.95, confidence)),
        status: 'active',
        evidence_ids: [evidence.id],
        tags: tags.length > 0 ? tags : [evidence.source_type],
        created_at: evidence.updated_at ?? now,
        updated_at: evidence.updated_at ?? now
      });
    }

    return results;
  }
}

// Module-level shared instance used by the standalone helper functions below.
// Direct instantiation of LearningsExtractor is preferred in code that needs
// isolation (e.g. tests).
const _sharedExtractor = new LearningsExtractor();

/** Runs the full extract pipeline using the shared extractor instance. */
export function extractLearningsFromEvidence(
  repoPath: string,
  contextCache?: EvidenceContextCache
): Promise<ExtractionResult> {
  return _sharedExtractor.extractLearningsFromEvidence(repoPath, contextCache);
}

/** Extracts learning records from evidence using the shared extractor instance. */
export function extractLearningRecords(
  signals: EvidenceSignal[],
  contextCache: EvidenceContextCache
): Promise<LearningRecord[]> {
  return _sharedExtractor.extractLearningRecords(signals, contextCache);
}

/**
 * Fast pre-filter that eliminates obvious non-lessons before incurring an LLM call.
 * Bots, CI checks, sub-threshold weights, and explicitly penalised items are all dropped here.
 */
function isEligibleForExtraction(signal: EvidenceSignal): boolean {
  if (
    signal.author_type === 'bot' ||
    /(coderabbit(?:ai)?|copilot|assistant|github-actions|ari|ivan|codex)/i.test(
      signal.author_name ?? ''
    )
  ) {
    return false;
  }

  if (signal.source_type === 'pr_check') {
    return false;
  }

  if ((signal.final_weight ?? 0) < 3) {
    return false;
  }

  if (signal.penalties.includes('low_signal_text')) {
    return false;
  }

  return true;
}

/**
 * Re-fetches content from GitHub for all evidence signals by grouping them by
 * parent PR URL and rebuilding the context cache from fresh payloads.
 */
async function refetchContextCache(
  repoPath: string,
  signals: EvidenceSignal[]
): Promise<EvidenceContextCache> {
  const cache: EvidenceContextCache = new Map();

  // Group signals by parent_url to identify unique PRs
  const prGroups = new Map<string, EvidenceSignal[]>();
  for (const signal of signals) {
    const prUrl = signal.parent_url ?? signal.external_url;
    if (!prUrl) continue;
    if (!prGroups.has(prUrl)) prGroups.set(prUrl, []);
    prGroups.get(prUrl)!.push(signal);
  }

  for (const [prUrl] of prGroups) {
    // Parse PR number from URL: https://github.com/owner/repo/pull/42
    const match = prUrl.match(/\/pull\/(\d+)/);
    if (!match) continue;
    const prNumber = parseInt(match[1], 10);

    const payload = await fetchGitHubPullRequestEvidence(repoPath, prNumber);
    const { contextCache: freshCache } = buildEvidenceSignalsFromPullRequest(payload);

    // Merge fresh context into the overall cache
    for (const [id, ctx] of freshCache) {
      cache.set(id, ctx);
    }
  }

  return cache;
}
