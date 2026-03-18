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
  writtenLearningCount: number;
  writtenPaths: string[];
  rebuild: LearningsBuildResult;
}

const BATCH_SIZE = 15;

/**
 * JSON Schema passed to OpenAI structured outputs (strict: true).
 * The model is constrained to emit exactly this shape — no runtime type-guards needed below.
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

Return one item per evidence item in the same order as the input.
Set lesson to null when the evidence is not worth a lesson.
Set rationale and applicability to null when not applicable.`;

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
    /(coderabbit(?:ai)?|copilot|assistant|github-actions|ari|ivan|codex)/i.test(
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
