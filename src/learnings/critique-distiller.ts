// Converts architect review critiques from expert mode into actionable learning records.
// This distiller mirrors the extraction pipeline pattern from extractor.ts but focuses on
// collaborative review feedback rather than GitHub PR discourse.

import OpenAI from 'openai';
import { z } from 'zod';
import { rebuildLearningsDatabase } from './builder.js';
import { createDeterministicId } from './id.js';
import { writeLearningRecords } from './learning-writer.js';
import { LESSONS_JSONL_RELATIVE_PATH } from './paths.js';
import type { LearningRecord } from './record-types.js';
import {
  ensureLearningsDirectories,
  resolveLearningsRepositoryContext
} from './repository.js';
import { loadCanonicalRecords } from './parser.js';

/**
 * Zod schema for the structured output returned by the distillation LLM call.
 * Returns 0..N lessons per critique (not 1:1).
 */
const LessonOutputSchema = z.object({
  statement: z.string(),
  kind: z.enum(['repo_convention', 'engineering_lesson']),
  confidence: z.number(),
  rationale: z.string().nullable(),
  applicability: z.string().nullable()
});

const DistillationResponseSchema = z.object({
  items: z.array(
    z.object({
      lessons: z.array(LessonOutputSchema)
    })
  )
});

type DistillationResponse = z.infer<typeof DistillationResponseSchema>;

/**
 * JSON Schema passed to OpenAI structured outputs (strict: true).
 * Derived from the Zod schema above to keep a single source of truth.
 */
const DISTILLATION_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          lessons: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                statement: { type: 'string' },
                kind: {
                  type: 'string',
                  enum: ['repo_convention', 'engineering_lesson']
                },
                confidence: { type: 'number' },
                rationale: { anyOf: [{ type: 'null' }, { type: 'string' }] },
                applicability: {
                  anyOf: [{ type: 'null' }, { type: 'string' }]
                }
              },
              required: [
                'statement',
                'kind',
                'confidence',
                'rationale',
                'applicability'
              ],
              additionalProperties: false
            }
          }
        },
        required: ['lessons'],
        additionalProperties: false
      }
    }
  },
  required: ['items'],
  additionalProperties: false
} as const;

const DISTILLATION_SYSTEM_PROMPT = `\
You are an expert at extracting actionable engineering lessons from architect review feedback in a collaborative development process.

For each critique, determine if it contains reusable engineering lessons worth preserving as institutional knowledge. A single critique often contains MULTIPLE distinct lessons — extract ALL of them.

If a critique contains no generalizable lessons (task-specific or one-off feedback), return an empty lessons array for that critique.

## Rewriting guidelines

Transform architect feedback into clear imperatives:

| Input pattern                                        | Output form                       |
|------------------------------------------------------|-----------------------------------|
| "I think X would be nice [as we Y]"                  | "Consider X [as we Y]"            |
| "I recommend X" / "I'd recommend X"                  | X                                 |
| "This should X" / "We should X"                      | X                                 |
| "Can we X?" / "Could we X?"                          | X                                 |
| "Needs to X" / "Need to X"                           | X                                 |
| "avoid X" / "prefer X" / "use X" / "ensure X"       | keep as-is (already imperative)   |
| "This doesn't X, we need Y"                          | Y                                 |
| "Missing X" / "Lacks X"                              | "Include X" / "Add X"             |

Write statements in sentence case (capitalize the first word only).
Ignore "VERDICT: APPROVE" or "VERDICT: REVISE" lines if present — these are markers, not lessons.

## Return empty lessons array for

- Task-specific implementation details: "Fix the login bug", "Add error handling to processPayment()"
- Single-file or single-function critiques without broader applicability
- Pure questions without extractable answers
- Stylistic nitpicks without architectural significance
- One-off corrections specific to this task

## Classification (kind)

"repo_convention" -- statement references project-specific tools or patterns:
  ivan, claude, hook, prompt, CLI, command, settings, GitHub workflow, worktree, specific file/directory names

"engineering_lesson" -- general software engineering patterns applicable beyond this repo.

## Confidence

These are single-source critiques (architect only, not validated by merge/approval), so confidence should be LOWER than multi-source PR learnings.

Derive from generalizability and certainty; target the [0.35, 0.75] range:
  - Broadly applicable architectural patterns, high certainty: 0.65-0.75
  - Specific but reusable patterns, medium certainty: 0.50-0.65
  - Narrowly applicable or uncertain guidance: 0.35-0.50

Return one item per critique in the same order as the input.
Set lessons to an empty array when the critique contains no reusable lessons.
Set rationale and applicability to null when not applicable.`;

/**
 * Distills architect critiques into learning records.
 * Holds the OpenAI client as an instance field, matching the codebase's class-based service pattern.
 */
export class CritiqueDistiller {
  private client: OpenAI | null = null;

  private getClient(): OpenAI {
    if (!this.client) this.client = new OpenAI();
    return this.client;
  }

  /**
   * Distills critiques into learning records via LLM and returns them.
   * Does not persist; caller is responsible for storage.
   */
  async distillCritiques(critiques: string[]): Promise<LearningRecord[]> {
    if (critiques.length === 0) return [];

    const userContent = critiques
      .map((critique, i) => {
        const cleaned = critique
          .replace(/VERDICT:\s*(APPROVE|APPROVED|REVISE)\s*$/im, '')
          .trim();
        return [`## Critique ${i + 1}`, '', cleaned].join('\n');
      })
      .join('\n\n---\n\n');

    const response = await this.getClient().chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'critique_distillation',
          strict: true,
          schema: DISTILLATION_SCHEMA
        }
      },
      messages: [
        { role: 'system', content: DISTILLATION_SYSTEM_PROMPT },
        { role: 'user', content: userContent }
      ]
    });

    let distillation: DistillationResponse;
    try {
      distillation = DistillationResponseSchema.parse(
        JSON.parse(response.choices[0]?.message?.content ?? '{"items":[]}')
      );
    } catch {
      return [];
    }

    const now = new Date().toISOString();
    const results: LearningRecord[] = [];

    // Flatten: extract all lessons from all critiques
    for (const item of distillation.items) {
      for (const lesson of item.lessons) {
        const { statement, kind, confidence, rationale, applicability } =
          lesson;
        const trimmed = statement.trim();
        if (trimmed.length < 4) continue;

        results.push({
          type: 'learning',
          sourcePath: LESSONS_JSONL_RELATIVE_PATH,
          id: createDeterministicId('lrn', 'collab', trimmed),
          kind,
          source_type: 'collaborative_review',
          statement: trimmed,
          title:
            trimmed.length <= 72
              ? trimmed
              : `${trimmed.slice(0, 69).trimEnd()}...`,
          ...(rationale !== null ? { rationale } : {}),
          ...(applicability !== null ? { applicability } : {}),
          confidence: Math.max(0.35, Math.min(0.75, confidence)),
          status: 'active',
          created_at: now,
          updated_at: now
        });
      }
    }

    return results;
  }
}

// Module-level shared instance used by the standalone helper function below.
const _sharedDistiller = new CritiqueDistiller();

/**
 * Best-effort capture of architect critiques as learning records.
 * Distills design and review critiques, merges with existing learnings, and rebuilds the database.
 * Wrapped in try/catch by the caller; any error should be logged but not fail the task.
 */
export async function captureLearnings(
  repoPath: string,
  designCritiques: string[],
  reviewCritiques: string[]
): Promise<void> {
  const allCritiques = [...designCritiques, ...reviewCritiques];
  if (allCritiques.length === 0) return;

  const context = resolveLearningsRepositoryContext(repoPath);
  ensureLearningsDirectories(context);

  const newRecords = await _sharedDistiller.distillCritiques(allCritiques);
  if (newRecords.length === 0) return;

  // Merge pattern from coding-sessions-command.ts:205-219
  const newRecordIds = new Set(newRecords.map((r) => r.id));
  const dataset = loadCanonicalRecords(repoPath);
  const existingRecords = dataset.learnings.filter(
    (r) => !newRecordIds.has(r.id)
  );
  const mergedRecords = [...existingRecords, ...newRecords];

  writeLearningRecords(repoPath, mergedRecords);
  await rebuildLearningsDatabase(repoPath);

  // Note: rebuildLearningsDatabase performs network calls (embedTexts → OpenAI) to generate
  // embeddings for any new/changed records, and rewrites lessons.jsonl with the cached vectors
  // (builder.ts:237 writeBackEmbeddings). This happens synchronously at the end of every
  // expert-mode task that triggers revisions. The rebuild is required to make new learnings
  // queryable immediately; without it, they sit in JSONL but won't appear in queryLearnings
  // results until something else triggers a rebuild (which may never happen in a worktree flow).
  //
  // Concurrent expert-mode tasks on the same main repo could interleave JSONL writes (no locking).
  // This is an accepted risk across the entire learnings pipeline (extractor.ts, coding-sessions,
  // etc. all have the same exposure). The best-effort try/catch in collaborative-executor.ts
  // ensures failures here never block task completion.
}
