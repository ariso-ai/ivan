import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import type { IClaudeExecutor, TurnResult } from './executor-factory.js';
import type { CollaborativeConfig } from '../config.js';
import { queryLearnings } from '../learnings/index.js';
import type { LearningsQueryResult } from '../learnings/types.js';

/**
 * The architect persona. A separate Claude session adopts this role to critique
 * the implementer across design and review rounds — Ivan acting as a principal
 * engineer / critical-thinking partner rather than a one-shot dispatcher.
 */
const ARCHITECT_SYSTEM_PROMPT = `You are a principal engineer reviewing a teammate's work. You hold your team's hard-won institutional knowledge and you care about correctness, simplicity, and long-term maintainability.

You are not the implementer — you do not write the code. Your job is to think critically: challenge questionable decisions, surface risks and edge cases, point out where the work diverges from the team's established lessons, and propose simpler or safer alternatives. Be specific and concrete; vague approval is worse than useless. You may read and inspect the codebase, but never modify it.

When you finish, end your message with exactly one line, nothing after it — one of:
VERDICT: APPROVE            (the work is sound; proceed)
VERDICT: APPROVE_WITH_NITS  (only minor, non-blocking suggestions remain — they can be folded in without another round)
VERDICT: REVISE            (a blocking problem must be fixed before proceeding)

Calibrate your verdict deliberately, because each REVISE costs a full revision round:
- Reserve REVISE for genuinely blocking issues: incorrectness, a wrong or risky approach, violated conventions, or real unaddressed risk.
- If the work is good enough to proceed and your remaining concerns are minor, stylistic, speculative, or better handled later, use APPROVE_WITH_NITS instead of spending another round.
- Iterate as many rounds as the problem genuinely needs, but do not manufacture concerns to keep iterating. When a design is sound, approve it.`;

/**
 * The product-reviewer persona for "loop" mode (Phase 4). A separate, skeptical
 * evaluator — an independent reviewer critiques far better than a generator
 * grading its own work — that runs AFTER the implementation is correct and asks
 * the different question: what would make this genuinely better for the user, in
 * features and in UX? It proposes concrete improvements and is disciplined about
 * scope, keeping the PR tight and deferring larger ideas to follow-ups.
 */
const PRODUCT_REVIEWER_SYSTEM_PROMPT = `You are a product-minded staff engineer pairing with a designer, reviewing a teammate's completed and correct implementation. The code already works and passed correctness review — your job is NOT to re-check correctness. Your job is to raise the bar: what would make this meaningfully better for the user, in features and in UX?

You care about the user's actual experience: complete features, graceful error / empty / loading states, sensible defaults, clear feedback, discoverability, accessibility, and consistency with the rest of the product. You propose concrete, specific improvements — never vague "polish it" notes — and you are honest about scope, keeping the current change tight and deferring anything large or risky to a follow-up. You may read and inspect the codebase, but never modify it.`;

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
  /**
   * When true ("loop" mode), run the Phase 4 improvement loop after the
   * correctness review: a product-minded reviewer pushes for feature/UX gains,
   * in-scope ones are implemented, and larger ideas are surfaced to the caller.
   */
  improve?: boolean;
}

/**
 * - `approve`: sound, proceed.
 * - `nits`: approved, but minor non-blocking notes to fold in without another round.
 * - `revise`: a blocking concern that warrants another revision round.
 */
type VerdictDecision = 'approve' | 'nits' | 'revise';

interface Verdict {
  decision: VerdictDecision;
  /** The architect's full message, fed back to the implementer when revising. */
  notes: string;
}

export interface CollaborativeRunResult extends TurnResult {
  /**
   * Present when the loop proceeded despite the architect's final verdict being
   * REVISE (round cap or stuck-detection reached). Holds the architect's
   * unresolved concern text so the caller can surface it to the human reviewer
   * (e.g. in the PR body) without aborting the autonomous run.
   */
  unresolvedConcerns?: string;
  /**
   * Present in "loop" mode when the Phase 4 product reviewer proposed
   * improvements it judged out of scope for this change (larger features or
   * riskier UX work). A newline-separated bullet list, surfaced to the human in
   * the PR body as "Future improvements" — proposed, never auto-built.
   */
  surfacedImprovements?: string;
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

  async run(params: CollaborativeRunParams): Promise<CollaborativeRunResult> {
    const {
      taskDescription,
      executionPath,
      learningsRepoPath,
      getDiff,
      incomingSessionId,
      improve
    } = params;

    const transcript: string[] = [];
    const record = (heading: string, body: string) => {
      transcript.push(`\n=== ${heading} ===\n${body}`);
    };

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
    // Separate session for the Phase 4 product reviewer ("loop" mode). Kept
    // distinct from the architect so its persona/model don't bleed together.
    let productSession: string | undefined;
    // Set when a phase proceeds despite an unresolved blocking (REVISE) verdict
    // (round cap or stuck-detection). Surfaced to the caller so the reviewer
    // sees what the architect rejected, without aborting the autonomous run.
    let unresolvedConcerns: string | undefined;
    // Accumulated in Phase 4 ("loop" mode): out-of-scope feature/UX ideas the
    // product reviewer proposed but did not build, surfaced to the human.
    let surfacedImprovements: string | undefined;

    // ----- Phase 1: design dialogue -----
    // The number of rounds is not fixed: the loop ends as soon as the architect
    // approves (or approves with nits), stops early if a concern is repeated
    // unresolved, and only otherwise runs up to maxDesignRounds as a safety cap.
    this.header('📐 Design dialogue');
    let plan = await this.turn(
      this.planPrompt(taskDescription, brief),
      executionPath,
      { sessionId: implSession, permissionMode: 'plan' },
      (r) => (implSession = r.sessionId)
    );
    record('Implementer — proposed plan', plan);

    let designNits: string | undefined;
    let previousDesignConcern: string | undefined;
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

      if (verdict.decision === 'approve') {
        console.log(chalk.green('✅ Architect approved the design.'));
        break;
      }
      if (verdict.decision === 'nits') {
        console.log(
          chalk.green(
            '✅ Architect approved the design with minor notes (folded into implementation).'
          )
        );
        designNits = verdict.notes;
        break;
      }
      // Blocking (revise).
      if (round === this.config.maxDesignRounds) {
        console.log(
          chalk.yellow(
            `⚠️  Design still has blocking concerns after ${round} round(s) (safety cap reached); proceeding with the latest plan.`
          )
        );
        unresolvedConcerns = verdict.notes;
        break;
      }
      if (
        previousDesignConcern &&
        this.isRepeatConcern(previousDesignConcern, verdict.notes)
      ) {
        console.log(
          chalk.yellow(
            '⚠️  Architect repeated the same unresolved concern; further design rounds are unlikely to help. Proceeding.'
          )
        );
        unresolvedConcerns = verdict.notes;
        break;
      }
      previousDesignConcern = verdict.notes;

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
      this.implementPrompt(designNits),
      executionPath,
      { sessionId: implSession, permissionMode: 'bypassPermissions' },
      (r) => (implSession = r.sessionId)
    );
    record('Implementer — implementation', implLog);
    // Tracks the most recent implementer output so the returned lastMessage
    // reflects the final code after any review revisions, not the first turn.
    let latestImplLog = implLog;

    // ----- Phase 3: code-review dialogue -----
    // Same dynamic termination as the design phase: ends on approval, accepts
    // minor nits without another round, stops on a repeated unresolved concern,
    // and uses maxReviewRounds only as a safety cap.
    let previousReviewConcern: string | undefined;
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

      if (verdict.decision === 'approve') {
        console.log(chalk.green('✅ Architect approved the implementation.'));
        break;
      }
      if (verdict.decision === 'nits') {
        console.log(
          chalk.green(
            '✅ Architect approved the implementation with minor notes; applying them without another review round.'
          )
        );
        this.header('🔨 Implementer — applying review nits');
        latestImplLog = await this.turn(
          this.applyNitsPrompt(verdict.notes),
          executionPath,
          { sessionId: implSession, permissionMode: 'bypassPermissions' },
          (r) => (implSession = r.sessionId)
        );
        record('Implementer — applied review nits', latestImplLog);
        break;
      }
      // Blocking (revise).
      if (round === this.config.maxReviewRounds) {
        console.log(
          chalk.yellow(
            `⚠️  Implementation still has blocking concerns after ${round} round(s) (safety cap reached); proceeding.`
          )
        );
        unresolvedConcerns = verdict.notes;
        break;
      }
      if (
        previousReviewConcern &&
        this.isRepeatConcern(previousReviewConcern, verdict.notes)
      ) {
        console.log(
          chalk.yellow(
            '⚠️  Architect repeated the same unresolved concern; further review rounds are unlikely to help. Proceeding.'
          )
        );
        unresolvedConcerns = verdict.notes;
        break;
      }
      previousReviewConcern = verdict.notes;

      this.header(`🔨 Implementer — applying review changes (round ${round})`);
      latestImplLog = await this.turn(
        this.reviseCodePrompt(verdict.notes),
        executionPath,
        { sessionId: implSession, permissionMode: 'bypassPermissions' },
        (r) => (implSession = r.sessionId)
      );
      record(`Implementer — revisions (round ${round})`, latestImplLog);
    }

    // ----- Phase 4: improvement loop ("loop" mode only) -----
    // The implementation is correct; now a product-minded reviewer looks at the
    // original request and the built diff and asks what would make it better in
    // features and UX. In-scope improvements are implemented; larger ideas are
    // surfaced. Same dynamic termination: stops when the reviewer ships, finds
    // no in-scope improvements, repeats itself, or hits the safety cap.
    if (improve) {
      const surfaced: string[] = [];
      let previousNow: string | undefined;
      this.header('🔁 Loop mode: reviewing for feature & UX improvements');

      // Visual UX probe: when enabled and the worktree supports Playwright and
      // the change touches UI, the reviewer is told to run the app and inspect
      // the rendered result — and its turn is granted command execution (still
      // read-only for source) so it can actually start a dev server + Playwright.
      const uxProbe =
        this.config.uxProbe.enabled &&
        this.repoSupportsPlaywright(executionPath) &&
        this.diffTouchesUi(getDiff())
          ? this.config.uxProbe
          : undefined;
      if (uxProbe) {
        console.log(
          chalk.gray(
            '🖼️  Playwright detected — the product reviewer will run the app and inspect the rendered UI.'
          )
        );
      }

      for (let round = 1; round <= this.config.maxImprovementRounds; round++) {
        const diff = this.truncateDiff(getDiff());
        if (!diff.trim()) {
          console.log(
            chalk.yellow(
              '⚠️  No changes to improve; skipping improvement loop.'
            )
          );
          break;
        }

        this.header(`🔭 Product review — improvements (round ${round})`);
        const review = await this.turn(
          this.improvementReviewPrompt(taskDescription, diff, brief, uxProbe),
          executionPath,
          {
            sessionId: productSession,
            // A UX probe needs to execute (start the app, drive Playwright), so
            // it runs with command execution allowed; readOnly still blocks all
            // source edits. Otherwise the reviewer only inspects, under 'plan'.
            permissionMode: uxProbe ? 'bypassPermissions' : 'plan',
            readOnly: true,
            systemPrompt: PRODUCT_REVIEWER_SYSTEM_PROMPT,
            model: this.config.productModel
          },
          (r) => (productSession = r.sessionId)
        );
        record(`Product review — improvements (round ${round})`, review);

        const { now, future, ship } = this.parseImprovements(review);
        for (const f of future) if (!surfaced.includes(f)) surfaced.push(f);

        if (ship || now.length === 0) {
          console.log(
            chalk.green(
              '✅ Product review: nothing further worth building in scope.'
            )
          );
          break;
        }

        const nowSignature = now.join('\n');
        if (previousNow && this.isRepeatConcern(previousNow, nowSignature)) {
          console.log(
            chalk.yellow(
              '⚠️  The same improvements resurfaced; the loop is not converging. Proceeding.'
            )
          );
          break;
        }
        previousNow = nowSignature;

        this.header(`🔨 Implementer — applying improvements (round ${round})`);
        latestImplLog = await this.turn(
          this.applyImprovementsPrompt(now),
          executionPath,
          { sessionId: implSession, permissionMode: 'bypassPermissions' },
          (r) => (implSession = r.sessionId)
        );
        record(
          `Implementer — applied improvements (round ${round})`,
          latestImplLog
        );

        if (round === this.config.maxImprovementRounds) {
          console.log(
            chalk.yellow(
              `⚠️  Improvement loop reached its safety cap (${round} round(s)); proceeding.`
            )
          );
        }
      }
      if (surfaced.length > 0) surfacedImprovements = surfaced.join('\n');
    }

    return {
      log: transcript.join('\n'),
      lastMessage: latestImplLog,
      sessionId: implSession || '',
      ...(unresolvedConcerns ? { unresolvedConcerns } : {}),
      ...(surfacedImprovements ? { surfacedImprovements } : {})
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
    // Order matters: APPROVE_WITH_NITS must be tested before APPROVE.
    const match = message.match(
      /VERDICT:\s*(APPROVE_WITH_NITS|APPROVE|APPROVED|REVISE)/i
    );
    // A missing/malformed verdict is treated as non-approval (revise): a
    // substantive critique with a forgotten trailer must never be read as
    // approval. The round cap bounds the downside of an over-cautious default.
    let decision: VerdictDecision = 'revise';
    if (match) {
      const token = match[1].toUpperCase();
      if (token === 'REVISE') decision = 'revise';
      else if (token === 'APPROVE_WITH_NITS') decision = 'nits';
      else decision = 'approve';
    }
    return { decision, notes: message };
  }

  /**
   * Parse the Phase 4 product reviewer's output. Improvements are emitted as
   * pipe-separated lines — `IMPROVEMENT | <feature|ux> | <now|future> | <text>`
   * — and the message ends with `VERDICT: SHIP` or `VERDICT: IMPROVE`.
   *
   * `now` items are implemented this round; `future` items are surfaced to the
   * human. A missing/malformed verdict defaults to SHIP when there are no `now`
   * items: unlike the correctness gate, the improvement loop biases toward
   * stopping (never invent work to keep looping).
   */
  private parseImprovements(message: string): {
    now: string[];
    future: string[];
    ship: boolean;
  } {
    const now: string[] = [];
    const future: string[] = [];
    const lineRe =
      /^\s*IMPROVEMENT\s*\|\s*(feature|ux)\s*\|\s*(now|future)\s*\|\s*(.+?)\s*$/i;
    for (const line of message.split('\n')) {
      const m = line.match(lineRe);
      if (!m) continue;
      const category = m[1].toLowerCase();
      const scope = m[2].toLowerCase();
      const entry = `- [${category}] ${m[3].trim()}`;
      if (scope === 'now') now.push(entry);
      else future.push(entry);
    }
    const verdict = message.match(/VERDICT:\s*(SHIP|IMPROVE)/i);
    const ship = verdict
      ? verdict[1].toUpperCase() === 'SHIP'
      : now.length === 0;
    return { now, future, ship };
  }

  /**
   * Best-effort detection of a repeated, unresolved concern. If the architect's
   * new critique is lexically near-identical to the previous round's, the
   * implementer likely could not resolve it and further rounds won't help, so we
   * stop and proceed. The threshold is high to avoid halting on genuinely new
   * feedback; the round cap remains the ultimate backstop.
   */
  private isRepeatConcern(previous: string, current: string): boolean {
    const tokenize = (s: string): Set<string> =>
      new Set(
        s
          .toLowerCase()
          .replace(/verdict:\s*\w+/gi, '')
          .replace(/[^a-z0-9\s]/g, ' ')
          .split(/\s+/)
          .filter((w) => w.length > 3)
      );
    const a = tokenize(previous);
    const b = tokenize(current);
    if (a.size === 0 || b.size === 0) return false;
    let intersection = 0;
    for (const word of a) if (b.has(word)) intersection++;
    const union = a.size + b.size - intersection;
    return union > 0 && intersection / union >= 0.85;
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

  private implementPrompt(nits?: string): string {
    const base = `Your plan has been approved by the reviewer. Implement it in full now. Follow the agreed approach and honor the institutional knowledge discussed earlier.`;
    if (!nits) return base;
    return `${base}

The reviewer approved the design but left minor, non-blocking notes. Address them where reasonable as you implement:

${nits}`;
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

  private applyNitsPrompt(notes: string): string {
    return `Your reviewer approved the implementation with only minor, non-blocking notes:

${notes}

Apply these minor improvements now where reasonable. Keep the changes small and focused — do not undertake larger rework.`;
  }

  private improvementReviewPrompt(
    task: string,
    diff: string,
    brief: string,
    uxProbe?: { startCommand?: string; url?: string }
  ): string {
    return `The implementation below is CORRECT and already passed code review. Your job now is different: figure out what would make it genuinely BETTER for the user — in features and in UX — relative to the original request.

ORIGINAL REQUEST:
${task}
${this.briefBlock(brief)}
IMPLEMENTED DIFF:
${diff}
${this.uxProbeBlock(uxProbe)}
Inspect the codebase read-only to ground yourself in how it actually behaves. Look concretely for:
- Feature completeness: capabilities the request implies but the diff doesn't deliver; obvious gaps a user hits immediately.
- UX quality: error / empty / loading states, input validation and feedback, sensible defaults, discoverability, consistency with existing patterns, accessibility, and the clarity of messages and output.

Be specific — no vague "polish it" notes. For each improvement, judge its scope honestly:
- \`now\`    = small, safe, and clearly within the original request's intent. These get implemented in this change.
- \`future\` = larger, riskier, or scope-broadening. These get surfaced to the human, not built.
When in doubt, choose \`future\` — keep this change tight.

List each improvement on its own line, in EXACTLY this pipe-separated format (nothing else on the line):
IMPROVEMENT | feature | now | <one concrete improvement>
IMPROVEMENT | ux | future | <one concrete improvement>

If nothing is worth changing, list no IMPROVEMENT lines.

End your message with exactly one line, nothing after it — one of:
VERDICT: IMPROVE   (you listed at least one \`now\` improvement to apply this round)
VERDICT: SHIP      (no \`now\` improvements remain — the work is ready to ship)`;
  }

  private applyImprovementsPrompt(now: string[]): string {
    return `A product reviewer identified these in-scope improvements to apply to your implementation now. Implement them fully, keeping each change focused, consistent with the existing code, and faithful to the team's conventions. Do NOT undertake large rework or broaden scope beyond these items:

${now.join('\n')}`;
  }

  /**
   * Instruction block that turns the UX review from "reason about the code" into
   * "observe the rendered UI." Injected only when the visual UX probe is active.
   * Screenshots come back into context for free because Read renders PNGs.
   */
  private uxProbeBlock(uxProbe?: {
    startCommand?: string;
    url?: string;
  }): string {
    if (!uxProbe) return '';
    const start = uxProbe.startCommand
      ? `Start the app in the background with \`${uxProbe.startCommand}\``
      : 'Start the app in the background (infer the dev command from package.json scripts, e.g. `npm run dev`)';
    const ready = uxProbe.url
      ? `, waiting until it is ready at ${uxProbe.url}`
      : '';
    return `
This repository has Playwright and this change appears to affect a user-facing UI. Before judging UX, OBSERVE the rendered result rather than only reasoning about the code:
1. ${start}${ready}. Use a timeout so a hung start can't stall you.
2. Drive Playwright to the screens this change affects, save screenshots to files in a temp directory, then Read those image files so you can see the actual rendered UI — real error / empty / loading states, layout, spacing, alignment, and interactions.
3. Base your UX critique on what you actually see, calling out anything that looks broken, misaligned, or confusing when rendered.
4. When finished, kill the app/server you started. If Playwright's browsers aren't installed, run \`npx playwright install\` once. If you still cannot run it, fall back to a static (code-only) review and say so explicitly.
Do NOT modify any source files while doing this.
`;
  }

  /**
   * Whether the worktree can run Playwright — a Playwright config file or a
   * playwright dependency in package.json. Best-effort and never throws.
   */
  private repoSupportsPlaywright(executionPath: string): boolean {
    try {
      const configNames = [
        'playwright.config.ts',
        'playwright.config.js',
        'playwright.config.mjs',
        'playwright.config.cjs'
      ];
      if (configNames.some((n) => fs.existsSync(path.join(executionPath, n)))) {
        return true;
      }
      const pkgPath = path.join(executionPath, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (deps['@playwright/test'] || deps['playwright']) return true;
      }
    } catch {
      // Malformed package.json or unreadable path — treat as unsupported.
    }
    return false;
  }

  /**
   * Heuristic: does the diff touch user-facing UI files? Gates the UX probe so we
   * don't spin up a dev server for a backend-only change.
   */
  private diffTouchesUi(diff: string): boolean {
    return /\.(tsx|jsx|vue|svelte|astro|css|scss|sass|less|html)\b/i.test(diff);
  }
}
