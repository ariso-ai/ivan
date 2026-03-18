// Converts raw evidence records into actionable learning records via LLM extraction.
// Pipeline: cheap pre-filter gates → batch to GPT-4o-mini → parse structured JSON output.

import OpenAI from 'openai';
import type { LearningsBuildResult } from './builder.js';
import { rebuildLearningsDatabase } from './builder.js';
import { createDeterministicId } from './id.js';
import { writeLearningRecords } from './learning-writer.js';
import { LESSONS_JSONL_RELATIVE_PATH } from './paths.js';
import { loadCanonicalRecords } from './parser.js';
import type { EvidenceRecord, LearningRecord } from './record-types.js';
import {
  ensureLearningsDirectories,
  resolveLearningsRepositoryContext
} from './repository.js';

export interface ExtractionResult {
  repositoryId: string;
  writtenLearningCount: number;
  writtenPaths: string[];
  rebuild: LearningsBuildResult;
}

const BATCH_SIZE = 15;

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

"repo_convention" — statement references project-specific tools or patterns:
  ivan, claude, hook, prompt, CLI, command, settings, GitHub workflow, worktree

"engineering_lesson" — general software engineering patterns applicable beyond this repo.

## Tags

Pick one or more from: cli, claude, async, concurrency, testing, github, configuration, parsing
Match tags to the semantic content of the statement. Use multiple tags when appropriate.

## Confidence

Derive from the provided weight (integer 1–12); clamp result to [0.35, 0.95]:
  weight 6+ → 0.85–0.95
  weight 4–5 → 0.65–0.80
  weight 3   → 0.50–0.60

## JSON output format

Return a JSON object with an "items" array — one entry per evidence item, in the same order as the input:

{
  "items": [
    {
      "evidence_id": "ev_abc",
      "lesson": {
        "statement": "Prefer X over Y when Z",
        "kind": "engineering_lesson",
        "tags": ["async"],
        "confidence": 0.70,
        "rationale": "Supporting context from the evidence (optional)",
        "applicability": "Brief hint about when to apply this lesson (optional)"
      }
    },
    {
      "evidence_id": "ev_def",
      "lesson": null
    }
  ]
}`;

interface LessonOutput {
  statement: string;
  kind: string;
  tags: string[];
  confidence: number;
  rationale?: string;
  applicability?: string;
}

interface LessonItem {
  evidence_id: string;
  lesson: LessonOutput | null;
}

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
  async extractLearningsFromEvidence(repoPath: string): Promise<ExtractionResult> {
    const context = resolveLearningsRepositoryContext(repoPath);
    ensureLearningsDirectories(context);

    const dataset = loadCanonicalRecords(context.repoPath);
    const extractedRecords = await this.extractLearningRecords(dataset.evidence);
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
   * Pre-filters evidence through cheap gates, then batches survivors to the LLM.
   * Returns records sorted by id for deterministic JSONL output.
   */
  async extractLearningRecords(
    evidenceRecords: EvidenceRecord[]
  ): Promise<LearningRecord[]> {
    const eligible = evidenceRecords.filter(isEligibleForExtraction);
    if (eligible.length === 0) return [];

    const all: LearningRecord[] = [];
    for (let i = 0; i < eligible.length; i += BATCH_SIZE) {
      const batch = eligible.slice(i, i + BATCH_SIZE);
      all.push(...(await this.extractBatch(batch)));
    }

    return all.sort((a, b) => a.id.localeCompare(b.id));
  }

  private async extractBatch(batch: EvidenceRecord[]): Promise<LearningRecord[]> {
    const userContent = batch
      .map((ev, i) =>
        [
          `## Evidence ${i + 1}`,
          `evidence_id: ${ev.id}`,
          `source_type: ${ev.source_type}`,
          `weight: ${ev.final_weight ?? ev.base_weight ?? 0}`,
          `author: ${ev.author_name ?? 'unknown'}`,
          ev.title != null ? `title: ${ev.title}` : null,
          ev.file_path != null ? `file: ${ev.file_path}` : null,
          `\n${ev.content}`
        ]
          .filter(Boolean)
          .join('\n')
      )
      .join('\n\n---\n\n');

    const response = await this.getClient().chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
        { role: 'user', content: userContent }
      ]
    });

    const raw = response.choices[0]?.message?.content ?? '{"items":[]}';

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }

    const items: LessonItem[] = Array.isArray(parsed)
      ? (parsed as LessonItem[])
      : (((parsed as Record<string, unknown>).items ?? []) as LessonItem[]);

    const now = new Date().toISOString();
    const results: LearningRecord[] = [];

    for (const item of items) {
      if (!item?.lesson || !item.evidence_id) continue;

      const evidence = batch.find((ev) => ev.id === item.evidence_id);
      if (!evidence) continue;

      const { statement, kind, tags, confidence, rationale, applicability } =
        item.lesson;

      if (!statement || typeof statement !== 'string' || statement.trim().length < 4) {
        continue;
      }

      const trimmed = statement.trim();

      const rationaleValue =
        typeof rationale === 'string' && rationale.trim()
          ? rationale.trim()
          : null;
      const applicabilityValue =
        typeof applicability === 'string' && applicability.trim()
          ? applicability.trim()
          : null;
      const confidenceValue =
        typeof confidence === 'number' && Number.isFinite(confidence)
          ? Math.max(0.35, Math.min(0.95, confidence))
          : null;

      results.push({
        type: 'learning',
        sourcePath: LESSONS_JSONL_RELATIVE_PATH,
        id: createDeterministicId('lrn', evidence.repository_id, evidence.id, trimmed),
        repository_id: evidence.repository_id,
        kind: kind === 'repo_convention' ? 'repo_convention' : 'engineering_lesson',
        source_type: 'github_pr_discourse',
        statement: trimmed,
        title:
          trimmed.length <= 72 ? trimmed : `${trimmed.slice(0, 69).trimEnd()}...`,
        ...(rationaleValue !== null ? { rationale: rationaleValue } : {}),
        ...(applicabilityValue !== null ? { applicability: applicabilityValue } : {}),
        ...(confidenceValue !== null ? { confidence: confidenceValue } : {}),
        status: 'active',
        evidence_ids: [evidence.id],
        tags:
          Array.isArray(tags) && tags.length > 0
            ? (tags as unknown[]).map(String).filter(Boolean)
            : [evidence.source_type],
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
  repoPath: string
): Promise<ExtractionResult> {
  return _sharedExtractor.extractLearningsFromEvidence(repoPath);
}

/** Extracts learning records from evidence using the shared extractor instance. */
export function extractLearningRecords(
  evidenceRecords: EvidenceRecord[]
): Promise<LearningRecord[]> {
  return _sharedExtractor.extractLearningRecords(evidenceRecords);
}

/**
 * Fast pre-filter that eliminates obvious non-lessons before incurring an LLM call.
 * Bots, CI checks, sub-threshold weights, and explicitly penalised items are all dropped here.
 */
function isEligibleForExtraction(evidence: EvidenceRecord): boolean {
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

  if ((evidence.final_weight ?? 0) < 3) {
    return false;
  }

  if (evidence.penalties.includes('low_signal_text')) {
    return false;
  }

  return true;
}
