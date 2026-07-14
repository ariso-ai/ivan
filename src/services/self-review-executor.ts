import chalk from 'chalk';
import type { IClaudeExecutor } from './executor-factory.js';
import type { SelfReviewConfig } from '../config.js';
import { queryLearnings } from '../learnings/index.js';
import type { LearningsQueryResult } from '../learnings/types.js';

/**
 * The reviewer persona for the pre-PR self review. A separate Claude Code
 * session reviews the change before it becomes a pull request — the same
 * "Claude Code reviewing its own code" pass a careful engineer would do before
 * hitting "Create PR". It is grounded in the team's institutional learnings and
 * an explicit engineering-quality bar, and it only asks for changes that are
 * genuinely worth making.
 */
const SELF_REVIEW_SYSTEM_PROMPT = `You are a meticulous principal engineer performing a pre-merge code review of a teammate's change before they open a pull request. Review the change (the diff) grounded in how the surrounding codebase actually works — read the relevant files to check your assumptions.

Hold the change to these standards:
- Correctness: bugs, logic errors, unhandled edge cases, wrong assumptions, race conditions, off-by-ones.
- Security: input validation, injection, authz/authn, secrets in code, unsafe deserialization, path traversal.
- Follow existing patterns: match the conventions, abstractions, and idioms already in this codebase instead of introducing new ones for no reason.
- Reuse over reinvention: use existing helpers, components, and utilities; extract shared logic rather than duplicating it; don't reinvent what the repo or a well-established library already provides.
- Right-sized, not over-engineered: no speculative abstraction, configuration, or generality for needs that don't exist yet — the simplest solution that fully solves the problem.
- Maintainability, no tech debt: clear names, no dead or commented-out code, no needless complexity, errors handled rather than swallowed, nothing a future reader will curse.
- Tests & docs: coverage proportional to the risk; update docs, comments, and types when behavior changes.

Be specific and concrete: reference file paths and line numbers, and prefer the smallest change that fixes the real issue. Do not manufacture problems — if the change is sound, say so. You may read and inspect the codebase, but do not modify it in this turn.

When you finish, end your message with exactly one line, nothing after it — one of:
VERDICT: LGTM              (no changes needed; the change is ready to ship)
VERDICT: CHANGES_REQUESTED (there are concrete, worth-fixing issues to address before opening the PR)`;

const MAX_DIFF_CHARS = 60000;

export interface SelfReviewParams {
  /** The diff to review (working-tree or branch diff, depending on the caller). */
  diff: string;
  /** The worktree path where the reviewer inspects and the fixer edits. */
  executionPath: string;
  /** Main repo path (where `.ivan/` lives) for querying learnings. */
  learningsRepoPath: string;
  /**
   * The implementer's session, resumed for the fix turn so it applies changes
   * with the full context of the work it just did.
   */
  implementerSessionId?: string;
}

export interface SelfReviewResult {
  /** True when the reviewer asked for changes and a fix turn was run. */
  changesRequested: boolean;
  /** The reviewer's full output, for the execution log. */
  reviewLog: string;
}

/**
 * Runs a pre-PR "Claude Code reviews its own code" pass: a fresh reviewer
 * session critiques the change against the team's learnings and engineering
 * best practices, and — when it requests changes — the implementer session
 * silently applies the fixes before the PR is opened. Correctness of the fixes
 * is the caller's to commit; this class just leaves them in the worktree.
 */
export class SelfReviewExecutor {
  constructor(
    private executor: IClaudeExecutor,
    private config: SelfReviewConfig
  ) {}

  async run(params: SelfReviewParams): Promise<SelfReviewResult> {
    const { diff, executionPath, learningsRepoPath, implementerSessionId } =
      params;

    if (!diff.trim()) {
      return { changesRequested: false, reviewLog: '' };
    }

    const brief = await this.buildBrief(learningsRepoPath, diff);

    this.header('🤖 Self-review: Claude Code reviewing its own changes');
    const review = await this.executor.executeTurn(
      this.reviewPrompt(this.truncateDiff(diff), brief),
      executionPath,
      {
        permissionMode: 'plan',
        readOnly: true,
        systemPrompt: SELF_REVIEW_SYSTEM_PROMPT,
        ...(this.config.model ? { model: this.config.model } : {})
      }
    );
    const reviewText = review.log?.trim() || review.lastMessage;

    if (!this.changesRequested(reviewText)) {
      console.log(chalk.green('✅ Self-review: no changes requested.'));
      return { changesRequested: false, reviewLog: reviewText };
    }

    this.header('🔧 Self-review: applying review fixes');
    await this.executor.executeTurn(this.fixPrompt(reviewText), executionPath, {
      sessionId: implementerSessionId,
      permissionMode: 'bypassPermissions'
    });

    return { changesRequested: true, reviewLog: reviewText };
  }

  /**
   * A missing/malformed verdict is treated as LGTM: the self-review is an
   * additive safety net, so an unparseable review must never trigger an
   * unbounded fix turn. Only an explicit CHANGES_REQUESTED requests fixes.
   */
  private changesRequested(message: string): boolean {
    return /VERDICT:\s*CHANGES_REQUESTED/i.test(message);
  }

  private async buildBrief(
    learningsRepoPath: string,
    queryText: string
  ): Promise<string> {
    let learnings: LearningsQueryResult[] = [];
    try {
      learnings = await queryLearnings(learningsRepoPath, queryText, {
        limit: 8
      });
    } catch {
      // No learnings store, or it failed to open — self-review still works.
      return '';
    }
    if (learnings.length === 0) return '';

    return learnings
      .map((l) => {
        const label = l.title || l.kind;
        const parts = [`- [${label}] ${l.statement}`];
        if (l.rationale) parts.push(`  Why: ${l.rationale}`);
        if (l.applicability) parts.push(`  When: ${l.applicability}`);
        return parts.join('\n');
      })
      .join('\n');
  }

  private reviewPrompt(diff: string, brief: string): string {
    const briefBlock = brief
      ? `\nInstitutional knowledge from this team (lessons from past PRs and coding sessions — weigh these heavily):\n${brief}\n`
      : '';
    return `Review the change below before it becomes a pull request. Inspect the codebase read-only to ground your review in how the code actually behaves.
${briefBlock}
DIFF:
${diff}`;
  }

  private fixPrompt(reviewNotes: string): string {
    return `A code reviewer reviewed your changes before opening the PR and asked for the following fixes:

${reviewNotes}

Apply the fixes for the real, in-scope issues now. Follow the existing patterns and the team's conventions, reuse existing code rather than duplicating it, and keep the changes minimal — do not broaden scope or over-engineer. If any requested item is genuinely not worth doing or is out of scope, briefly note why instead of forcing it.`;
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
}
