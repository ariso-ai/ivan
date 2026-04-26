// Extracts thinking patterns AND example interactions from parsed session digests
// using GPT-5.5. Classification and extraction happen in a single LLM pass per session.
// Follows the same structured-output pattern as extractor.ts.

import OpenAI from 'openai';
import { ConfigManager } from '../config.js';
import { createDeterministicId } from './id.js';
import { LESSONS_JSONL_RELATIVE_PATH } from './paths.js';
import type { LearningRecord } from './record-types.js';
import type { SessionDigest } from './session-parser.js';

const MODEL = 'gpt-5.5';

export interface SessionAnalysis {
  sessionId: string;
  hasSignal: boolean;
  sessionTopic: string;
  patterns: ExtractedPattern[];
  exampleInteractions: ExtractedInteraction[];
}

interface ExtractedPattern {
  statement: string;
  kind:
    | 'thinking_architecture'
    | 'thinking_product'
    | 'thinking_quality'
    | 'thinking_process';
  confidence: number;
  rationale: string | null;
  applicability: string | null;
}

interface ExtractedInteraction {
  context: string;
  user_message: string;
  derived_question: string;
  when_to_ask: string;
  confidence: number;
}

/**
 * JSON Schema for GPT-5.5 structured output.
 * The model is constrained to emit exactly this shape.
 */
const ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    has_signal: { type: 'boolean' },
    session_topic: { type: 'string' },
    patterns: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          statement: { type: 'string' },
          kind: {
            type: 'string',
            enum: [
              'thinking_architecture',
              'thinking_product',
              'thinking_quality',
              'thinking_process'
            ]
          },
          confidence: { type: 'number' },
          rationale: { anyOf: [{ type: 'null' }, { type: 'string' }] },
          applicability: { anyOf: [{ type: 'null' }, { type: 'string' }] }
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
    },
    example_interactions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          context: { type: 'string' },
          user_message: { type: 'string' },
          derived_question: { type: 'string' },
          when_to_ask: { type: 'string' },
          confidence: { type: 'number' }
        },
        required: [
          'context',
          'user_message',
          'derived_question',
          'when_to_ask',
          'confidence'
        ],
        additionalProperties: false
      }
    }
  },
  required: ['has_signal', 'session_topic', 'patterns', 'example_interactions'],
  additionalProperties: false
} as const;

const SYSTEM_PROMPT = `\
You are analyzing coding sessions between a CEO/product architect and an AI coding assistant (Claude).

You have two goals:
1. Extract reusable THINKING PATTERNS — how this person reasons about systems, products, quality, and decisions.
2. Extract EXAMPLE INTERACTIONS — key moments where the user asked a question, made a correction, or
   redirected the AI that reveal how a product architect thinks. These will be preserved as example
   questions for the AI to consider asking in future similar tasks.

For each session, determine if it contains meaningful signal. If yes, extract both patterns and
example interactions. If no (routine coding with no decisions or corrections), set has_signal to false
and return empty arrays.

## Thinking Patterns

Extract reusable principles as imperative statements.

What to look for:
- **Architecture decisions**: System design, data flow, separation of concerns, when to use existing
  solutions vs custom code, pipeline design, data modeling choices.
- **Product reasoning**: How they connect technical choices to user/business value, UX philosophy,
  data presentation choices, feature prioritization.
- **Quality standards**: What they reject, what "done right" means to them, debugging philosophy
  (root cause vs band-aid), when to use established libraries vs custom implementations.
- **Process/decision-making**: How they evaluate tradeoffs, when they choose simplicity vs power.

Good pattern examples:
- "When a visualization takes more than 2 iterations, switch to an established library"
- "Always question whether null/missing data needs its own category"
- "Separate concerns by data domain, not by technical layer"

Classification (kind):
- thinking_architecture: System design, data modeling, integration, scalability
- thinking_product: UX, business value, feature priorities, user experience
- thinking_quality: Quality standards, debugging, testing, technical debt
- thinking_process: Decision-making style, delegation, workflow

## Example Interactions

These are the most valuable part. Find moments where the user:
- Asked a probing question that reframed the problem
- Corrected the AI's approach in a way that reveals a deeper standard
- Redirected from implementation details to business/product concerns
- Challenged whether the current approach was the right one

For each, capture:
- context: Brief description of what was happening (1-2 sentences)
- user_message: The actual user message (quote it closely, can be paraphrased for clarity)
- derived_question: A reusable question to ask in similar future situations, written as an
  imperative prompt (e.g., "Before implementing X, ask: ...")
- when_to_ask: When this question is relevant (specific trigger conditions)

Good example interaction:
- context: "Building a Sankey chart to visualize meeting productivity scores"
- user_message: "should we separate score = null into its own category? unrated or something?"
- derived_question: "Before implementing data visualizations with categorical breakdowns, ask: does
  null/missing data need its own category, or should it be grouped with an existing bucket?"
- when_to_ask: "When building charts, dashboards, or data visualizations that categorize data into
  groups — especially when the data has optional/nullable fields"

Bad examples (too trivial):
- "Can you fix the typo?" (no thinking signal)
- "Make it blue" (too specific, no transferable question)

## Confidence

- 0.85-0.95: User explicitly stated the principle or the question is directly quotable
- 0.65-0.80: Pattern/question clearly demonstrated through decisions
- 0.50-0.60: Inferred from context with some uncertainty

## Conversation dynamics context

Each session includes computed dynamics:
- correctionDensity: Ratio of corrections (higher = more opinionated session)
- questionCount: Number of probing questions (higher = more exploratory)
- hasEscalationArc: Whether user escalated from specific issue to systemic concern
- topicShifts: Number of topic changes (higher = broader thinking)`;

export class SessionAnalyzer {
  private client: OpenAI | null = null;

  private getClient(): OpenAI {
    if (!this.client) {
      // Try OPENAI_API_KEY env var first, then fall back to ivan config
      const envKey = process.env['OPENAI_API_KEY'];
      if (envKey) {
        this.client = new OpenAI();
      } else {
        const config = new ConfigManager().getConfig();
        const apiKey = config?.openaiApiKey;
        if (!apiKey) {
          throw new Error(
            'No OpenAI API key found. Set OPENAI_API_KEY or run "ivan reconfigure".'
          );
        }
        this.client = new OpenAI({ apiKey });
      }
    }
    return this.client;
  }

  /**
   * Analyzes a single session digest and extracts thinking patterns + example interactions.
   */
  async analyzeSession(digest: SessionDigest): Promise<SessionAnalysis> {
    const userContent = buildUserContent(digest);

    const response = await this.getClient().chat.completions.create({
      model: MODEL,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'session_analysis',
          strict: true,
          schema: ANALYSIS_SCHEMA
        }
      },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent }
      ]
    });

    let parsed: {
      has_signal: boolean;
      session_topic: string;
      patterns: ExtractedPattern[];
      example_interactions: ExtractedInteraction[];
    };
    try {
      parsed = JSON.parse(
        response.choices[0]?.message?.content ??
          '{"has_signal":false,"session_topic":"","patterns":[],"example_interactions":[]}'
      );
    } catch {
      return {
        sessionId: digest.sessionId,
        hasSignal: false,
        sessionTopic: '',
        patterns: [],
        exampleInteractions: []
      };
    }

    return {
      sessionId: digest.sessionId,
      hasSignal: parsed.has_signal,
      sessionTopic: parsed.session_topic,
      patterns: parsed.patterns.filter(
        (p) => p.statement && p.statement.trim().length >= 10
      ),
      exampleInteractions: (parsed.example_interactions ?? []).filter(
        (e) => e.derived_question && e.derived_question.trim().length >= 10
      )
    };
  }

  /**
   * Converts analysis results into LearningRecord objects ready for storage.
   * Both thinking patterns and example interactions become learning records.
   * Each record is tagged with its source project for relevance filtering.
   */
  analysisToLearningRecords(
    analysis: SessionAnalysis,
    digest: SessionDigest
  ): LearningRecord[] {
    if (!analysis.hasSignal) return [];

    const now = new Date().toISOString();
    const records: LearningRecord[] = [];
    const project = extractProjectName(digest.projectPath);
    const projectTag = `project:${project}`;

    // Thinking patterns
    for (const pattern of analysis.patterns) {
      const trimmed = pattern.statement.trim();
      const applicability = prependProject(project, pattern.applicability);

      records.push({
        type: 'learning',
        sourcePath: LESSONS_JSONL_RELATIVE_PATH,
        id: createDeterministicId('lrn', digest.sessionId, trimmed),
        kind: pattern.kind,
        source_type: 'coding_session',
        source_url: projectTag,
        statement: trimmed,
        title:
          trimmed.length <= 72
            ? trimmed
            : `${trimmed.slice(0, 69).trimEnd()}...`,
        rationale: pattern.rationale ?? undefined,
        applicability,
        confidence: Math.max(0.35, Math.min(0.95, pattern.confidence)),
        status: 'active',
        created_at: digest.timestamp ?? now,
        updated_at: now
      });
    }

    // Example interactions → stored as learning records with kind 'example_question'
    for (const interaction of analysis.exampleInteractions) {
      const question = interaction.derived_question.trim();
      const statement = question;
      const rationale = `Context: ${interaction.context}\nOriginal user message: "${interaction.user_message}"`;
      const applicability = prependProject(project, interaction.when_to_ask);

      records.push({
        type: 'learning',
        sourcePath: LESSONS_JSONL_RELATIVE_PATH,
        id: createDeterministicId('lrn', digest.sessionId, question),
        kind: 'example_question',
        source_type: 'coding_session',
        source_url: projectTag,
        statement,
        title:
          statement.length <= 72
            ? statement
            : `${statement.slice(0, 69).trimEnd()}...`,
        rationale,
        applicability,
        confidence: Math.max(0.35, Math.min(0.95, interaction.confidence)),
        status: 'active',
        created_at: digest.timestamp ?? now,
        updated_at: now
      });
    }

    return records;
  }
}

/**
 * Formats a session digest into the user content for the LLM prompt.
 * Interleaves user and assistant messages to preserve conversation flow.
 */
function buildUserContent(digest: SessionDigest): string {
  const lines: string[] = [];

  lines.push(`## Session: ${digest.aiTitle ?? 'Untitled'}`);
  lines.push(`Project: ${digest.projectPath}`);
  lines.push(`Timestamp: ${digest.timestamp}`);
  lines.push(`Entry point: ${digest.entrypoint}`);
  lines.push('');
  lines.push('### Conversation Dynamics');
  lines.push(`- Turns: ${digest.dynamics.turnCount}`);
  lines.push(
    `- Correction density: ${(digest.dynamics.correctionDensity * 100).toFixed(0)}%`
  );
  lines.push(`- Questions asked: ${digest.dynamics.questionCount}`);
  lines.push(
    `- Avg user message length: ${Math.round(digest.dynamics.avgUserMsgLength)} chars`
  );
  lines.push(`- Has escalation arc: ${digest.dynamics.hasEscalationArc}`);
  lines.push(`- Topic shifts: ${digest.dynamics.topicShifts}`);
  lines.push('');
  lines.push('### Conversation Transcript');
  lines.push('');

  // Interleave user and assistant messages in order
  let userIdx = 0;
  let assistantIdx = 0;
  const maxExchanges = 30; // Cap to stay within token budget
  let exchanges = 0;

  while (
    exchanges < maxExchanges &&
    (userIdx < digest.userMessages.length ||
      assistantIdx < digest.assistantResponses.length)
  ) {
    if (userIdx < digest.userMessages.length) {
      const msg = digest.userMessages[userIdx];
      // Truncate very long user messages
      const truncated = msg.length > 1000 ? `${msg.slice(0, 1000)}...` : msg;
      lines.push(`**User:** ${truncated}`);
      lines.push('');
      userIdx++;
    }

    if (assistantIdx < digest.assistantResponses.length) {
      const msg = digest.assistantResponses[assistantIdx];
      lines.push(`**Assistant:** ${msg}`);
      lines.push('');
      assistantIdx++;
    }

    exchanges++;
  }

  if (
    userIdx < digest.userMessages.length ||
    assistantIdx < digest.assistantResponses.length
  ) {
    const remaining =
      digest.userMessages.length -
      userIdx +
      (digest.assistantResponses.length - assistantIdx);
    lines.push(`[${remaining} additional messages truncated]`);
  }

  return lines.join('\n');
}

/**
 * Extracts a clean project name from a Claude Code project path.
 * e.g., "-Users-erkang-Repos-ariso-agents" → "agents"
 */
function extractProjectName(projectPath: string): string {
  const parts = projectPath.split('-').filter(Boolean);
  return parts[parts.length - 1] ?? projectPath;
}

/**
 * Prepends "Learned from project: X. " to the applicability text so the
 * project context gets baked into the vector embedding for relevance ranking.
 */
function prependProject(
  project: string,
  applicability: string | null | undefined
): string {
  const prefix = `Learned from project: ${project}.`;
  if (!applicability) return prefix;
  return `${prefix} ${applicability}`;
}
