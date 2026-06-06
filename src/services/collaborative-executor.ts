import chalk from 'chalk';
import type { IClaudeExecutor, TurnResult } from './executor-factory.js';
import type { CollaborativeConfig } from '../config.js';
import { queryLearnings } from '../learnings/index.js';
import type { LearningsQueryResult } from '../learnings/types.js';
import { captureLearnings } from '../learnings/critique-distiller.js';

/**
 * The architect persona. A separate Claude session adopts this role to critique
 * the implementer across design and review rounds — Ivan acting as a principal
 * engineer / critical-thinking partner rather than a one-shot dispatcher.
 */
const ARCHITECT_SYSTEM_PROMPT = `You are a principal engineer reviewing a teammate's work. You hold your team's hard-won institutional knowledge and you care about correctness, simplicity, and long-term maintainability.

You are not the implementer — you do not write the code. Your job is to think critically: challenge questionable decisions, surface risks and edge cases, point out where the work diverges from the team's established lessons, and propose simpler or safer alternatives. Be specific and concrete; vague approval is worse than useless. You may read and inspect the codebase, but never modify it.

When you finish, end your message with exactly one line, nothing after it:
VERDICT: APPROVE
or
VERDICT: REVISE`;

const MAX_DIFF_CHARS = 60000;

export interface CollaborativeRunParams {
  /** The task to accomplish (already including any repo-specific instructions). */
  taskDescription: string;
  /** The worktree path where the implementer should edit and the architect inspects. */
  executionPath: string;
  /**
   * The main repository path (where `.ivan/` lives). Used to query learnings,
   * since the worktree does not contain the learnings store.
   */
  learningsRepoPath: string;
  /** Returns the current working-tree diff for the review phase. */
  getDiff: () => string;
  /** Optional session to resume so multi-task / single-PR runs keep context. */
  incomingSessionId?: string;
}

interface Verdict {
  approve: boolean;
  /** The architect's full message, fed back to the implementer when revising. */
  notes: string;
}

/**
 * Drives an "expert"-mode collaboration: a separate architect Claude session
 * critiques an implementer Claude session across a design dialogue, then the
 * implementation, then a code-review dialogue — informed by the team's
 * institutional learnings. The implementer's final session is returned so
 * callers can thread context across tasks (single-PR mode).
 */
export class CollaborativeExecutor {
  constructor(
    private executor: IClaudeExecutor,
    private config: CollaborativeConfig
  ) {}

  async run(params: CollaborativeRunParams): Promise<TurnResult> {
    const {
      taskDescription,
      executionPath,
      learningsRepoPath,
      getDiff,
      incomingSessionId
    } = params;

    const transcript: string[] = [];
    const record = (heading: string, body: string) => {
      transcript.push(`\n=== ${heading} ===\n${body}`);
    };

    // Collect architect critiques that triggered revisions for later learning capture
    const designCritiques: string[] = [];
    const reviewCritiques: string[] = [];

    this.header('🧠 Expert mode: assembling institutional knowledge');
    const brief = await this.buildBrief(learningsRepoPath, taskDescription);
    if (brief) {
      console.log(chalk.gray(brief));
      record('Institutional knowledge', brief);
    } else {
      console.log(
        chalk.gray('No relevant learnings found — proceeding without a brief.')
      );
    }

    let implSession = incomingSessionId;
    let architectSession: string | undefined;

    // ----- Phase 1: design dialogue -----
    this.header('📐 Design dialogue');
    let plan = await this.turn(
      this.planPrompt(taskDescription, brief),
      executionPath,
      { sessionId: implSession, permissionMode: 'plan' },
      (r) => (implSession = r.sessionId)
    );
    record('Implementer — proposed plan', plan);

    for (let round = 1; round <= this.config.maxDesignRounds; round++) {
      this.header(`🏛️  Architect — design review (round ${round})`);
      const review = await this.turn(
        this.designReviewPrompt(taskDescription, plan, brief),
        executionPath,
        {
          sessionId: architectSession,
          permissionMode: 'plan',
          readOnly: true,
          systemPrompt: ARCHITECT_SYSTEM_PROMPT,
          model: this.config.architectModel
        },
        (r) => (architectSession = r.sessionId)
      );
      const verdict = this.parseVerdict(review);
      record(`Architect — design review (round ${round})`, review);

      if (verdict.approve) {
        console.log(chalk.green('✅ Architect approved the design.'));
        break;
      }
      if (round === this.config.maxDesignRounds) {
        console.log(
          chalk.yellow(
            '⚠️  Design rounds exhausted; proceeding with the latest plan.'
          )
        );
        break;
      }

      // Collect this critique for later learning capture
      designCritiques.push(verdict.notes);

      this.header(`🔨 Implementer — revising plan (round ${round})`);
      plan = await this.turn(
        this.revisePlanPrompt(verdict.notes),
        executionPath,
        { sessionId: implSession, permissionMode: 'plan' },
        (r) => (implSession = r.sessionId)
      );
      record(`Implementer — revised plan (round ${round})`, plan);
    }

    // ----- Phase 2: implementation -----
    this.header('🛠️  Implementation');
    const implLog = await this.turn(
      this.implementPrompt(),
      executionPath,
      { sessionId: implSession, permissionMode: 'bypassPermissions' },
      (r) => (implSession = r.sessionId)
    );
    record('Implementer — implementation', implLog);

    // ----- Phase 3: code-review dialogue -----
    for (let round = 1; round <= this.config.maxReviewRounds; round++) {
      const diff = this.truncateDiff(getDiff());
      if (!diff.trim()) {
        console.log(
          chalk.yellow('⚠️  No changes to review; skipping code review.')
        );
        break;
      }

      this.header(`🏛️  Architect — code review (round ${round})`);
      const review = await this.turn(
        this.codeReviewPrompt(taskDescription, plan, diff, brief),
        executionPath,
        {
          sessionId: architectSession,
          permissionMode: 'plan',
          readOnly: true,
          systemPrompt: ARCHITECT_SYSTEM_PROMPT,
          model: this.config.architectModel
        },
        (r) => (architectSession = r.sessionId)
      );
      const verdict = this.parseVerdict(review);
      record(`Architect — code review (round ${round})`, review);

      if (verdict.approve) {
        console.log(chalk.green('✅ Architect approved the implementation.'));
        break;
      }
      if (round === this.config.maxReviewRounds) {
        console.log(
          chalk.yellow(
            '⚠️  Review rounds exhausted; proceeding with the current implementation.'
          )
        );
        break;
      }

      // Collect this critique for later learning capture
      reviewCritiques.push(verdict.notes);

      this.header(`🔨 Implementer — applying review changes (round ${round})`);
      const revisionLog = await this.turn(
        this.reviseCodePrompt(verdict.notes),
        executionPath,
        { sessionId: implSession, permissionMode: 'bypassPermissions' },
        (r) => (implSession = r.sessionId)
      );
      record(`Implementer — revisions (round ${round})`, revisionLog);
    }

    // Best-effort capture of architect critiques as learnings
    if (
      this.config.captureLearnings &&
      (designCritiques.length > 0 || reviewCritiques.length > 0)
    ) {
      try {
        await captureLearnings(
          learningsRepoPath,
          designCritiques,
          reviewCritiques
        );
        console.log(
          chalk.gray(
            `📚 Captured ${designCritiques.length + reviewCritiques.length} critique(s) as learnings`
          )
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(chalk.gray(`Learnings capture skipped: ${msg}`));
      }
    }

    return {
      log: transcript.join('\n'),
      lastMessage: implLog,
      sessionId: implSession || ''
    };
  }

  /**
   * Runs a turn, captures its session id via the callback, and returns the
   * full output text. We use `log` (the complete transcript) rather than
   * `lastMessage` because the CLI executor only captures the last stdout line
   * there, which would truncate the architect's critique and verdict.
   */
  private async turn(
    prompt: string,
    executionPath: string,
    options: Parameters<IClaudeExecutor['executeTurn']>[2],
    onResult: (r: TurnResult) => void
  ): Promise<string> {
    const r = await this.executor.executeTurn(prompt, executionPath, options);
    onResult(r);
    return r.log?.trim() || r.lastMessage;
  }

  private async buildBrief(
    learningsRepoPath: string,
    taskDescription: string
  ): Promise<string> {
    let learnings: LearningsQueryResult[] = [];
    try {
      learnings = await queryLearnings(learningsRepoPath, taskDescription, {
        limit: 8
      });
    } catch {
      // No learnings store, or it failed to open — expert mode still works.
      return '';
    }
    if (learnings.length === 0) return '';

    return learnings
      .map((l) => {
        const label = l.title || l.kind;
        const parts = [`- [${label}] ${l.statement}`];
        if (l.rationale) parts.push(`  Why: ${l.rationale}`);
        if (l.applicability) parts.push(`  When: ${l.applicability}`);
        if (l.source_url) parts.push(`  Source: ${l.source_url}`);
        return parts.join('\n');
      })
      .join('\n');
  }

  private parseVerdict(message: string): Verdict {
    const match = message.match(/VERDICT:\s*(APPROVE|APPROVED|REVISE)/i);
    // Default to approve when no explicit verdict is found, to avoid burning
    // rounds on an ambiguous response.
    const approve = match ? /APPROVE/i.test(match[1]) : true;
    return { approve, notes: message };
  }

  private truncateDiff(diff: string): string {
    if (diff.length <= MAX_DIFF_CHARS) return diff;
    return (
      diff.slice(0, MAX_DIFF_CHARS) +
      `\n\n[... diff truncated at ${MAX_DIFF_CHARS} characters. Read the files directly to review the rest. ...]`
    );
  }

  private header(text: string): void {
    console.log('');
    console.log(chalk.magenta.bold(text));
  }

  // ----- Prompt builders -----

  private briefBlock(brief: string): string {
    return brief
      ? `\nRelevant institutional knowledge (lessons from this team's past PRs and coding sessions — weigh these heavily):\n${brief}\n`
      : '';
  }

  private planPrompt(task: string, brief: string): string {
    return `${task}
${this.briefBlock(brief)}
Before writing any code, think like you're pairing with a senior engineer. Produce a concise technical plan: your intended approach, the key files you'll touch, the edge cases you'll handle, and any risks or trade-offs. Do NOT implement anything yet — respond with the plan only.`;
  }

  private designReviewPrompt(
    task: string,
    plan: string,
    brief: string
  ): string {
    return `Review a teammate's PROPOSED PLAN for the following task. No code has been written yet.

TASK:
${task}
${this.briefBlock(brief)}
PROPOSED PLAN:
${plan}

Scrutinize the plan. Inspect the codebase (read-only) as needed to ground your critique. Look for: a wrong or over-complicated approach, missed edge cases, anything that violates the institutional knowledge above, unaddressed risks, and simpler alternatives.`;
  }

  private revisePlanPrompt(notes: string): string {
    return `Your reviewer (a principal engineer) raised the following on your plan:

${notes}

Revise your technical plan to address this feedback. Do NOT implement yet — respond with the updated plan only.`;
  }

  private implementPrompt(): string {
    return `Your plan has been approved by the reviewer. Implement it in full now. Follow the agreed approach and honor the institutional knowledge discussed earlier.`;
  }

  private codeReviewPrompt(
    task: string,
    plan: string,
    diff: string,
    brief: string
  ): string {
    return `Review your teammate's IMPLEMENTATION (the diff below) for this task.

TASK:
${task}

AGREED PLAN:
${plan}
${this.briefBlock(brief)}
DIFF:
${diff}

Review for correctness bugs, deviations from the agreed plan, violations of the institutional knowledge, missing tests or edge cases, and simplification opportunities. You may inspect the codebase read-only.`;
  }

  private reviseCodePrompt(notes: string): string {
    return `Your reviewer (a principal engineer) requested changes:

${notes}

Apply these changes to the implementation now.`;
  }
}
