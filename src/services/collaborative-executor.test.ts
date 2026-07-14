import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { CollaborativeExecutor } from './collaborative-executor.js';
import type {
  IClaudeExecutor,
  TurnResult,
  TurnOptions
} from './executor-factory.js';
import type { CollaborativeConfig } from '../config.js';
import type { CollaborativeRunResult } from './collaborative-executor.js';

/**
 * These tests drive the whole expert/loop collaboration offline via the
 * constructor's IClaudeExecutor seam — no Claude, git, or network. The fake
 * decides which persona is "speaking" from options.systemPrompt (architect vs
 * product reviewer) and reads scripted product-review responses from a queue,
 * so we can assert Phase 4's termination behavior deterministically.
 *
 * buildBrief is exercised too: learningsRepoPath points at an empty temp dir, so
 * openLearningsDatabase throws (missing store), buildBrief swallows it, and no
 * embedding/network call is ever reached.
 */

const CFG: CollaborativeConfig = {
  architectModel: 'test-model',
  maxDesignRounds: 3,
  maxReviewRounds: 3,
  productModel: 'test-model',
  maxImprovementRounds: 3,
  uxProbe: { enabled: false }
};

const DIFF = 'diff --git a/f b/f\n@@\n+const x = 1;';

interface FakeCounts {
  architectReviews: number;
  productReviews: number;
  applyImprovements: number;
  applyPrompts: string[];
  lastProductPrompt: string;
  lastProductPermission?: string;
}

function makeFake(reviews: string[]): {
  fake: IClaudeExecutor;
  counts: FakeCounts;
} {
  const counts: FakeCounts = {
    architectReviews: 0,
    productReviews: 0,
    applyImprovements: 0,
    applyPrompts: [],
    lastProductPrompt: ''
  };
  let reviewIdx = 0;
  const turn = (text: string): TurnResult => ({
    log: text,
    lastMessage: text,
    sessionId: 'sess'
  });

  const fake: IClaudeExecutor = {
    quietMode: true,
    async executeTurn(
      prompt: string,
      _dir: string,
      options: TurnOptions = {}
    ): Promise<TurnResult> {
      const systemPrompt = options.systemPrompt ?? '';
      // Architect persona (design + code review) — always approve so Phases
      // 1-3 finish in one round each and Phase 4 gets to run.
      if (systemPrompt.includes('principal engineer')) {
        counts.architectReviews++;
        return turn('Looks sound.\nVERDICT: APPROVE');
      }
      // Product reviewer persona (Phase 4) — scripted responses.
      if (systemPrompt.includes('product-minded')) {
        counts.productReviews++;
        counts.lastProductPrompt = prompt;
        counts.lastProductPermission = options.permissionMode;
        const text = reviews[reviewIdx] ?? 'VERDICT: SHIP';
        reviewIdx++;
        return turn(text);
      }
      // Implementer — distinguish the "apply improvements" turn by its prompt.
      if (prompt.includes('in-scope improvements to apply')) {
        counts.applyImprovements++;
        counts.applyPrompts.push(prompt);
      }
      return turn('done');
    },
    async executeTask(): Promise<TurnResult> {
      return turn('done');
    },
    async generateTaskBreakdown(): Promise<string[]> {
      return [];
    },
    async validateClaudeCodeInstallation(): Promise<void> {}
  };

  return { fake, counts };
}

function runLoop(
  fake: IClaudeExecutor,
  opts: {
    improve?: boolean;
    diff?: string;
    cfg?: CollaborativeConfig;
    setupRepo?: (dir: string) => void;
  } = {}
): Promise<CollaborativeRunResult> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ivan-loop-test-'));
  opts.setupRepo?.(tmp);
  const diff = opts.diff ?? DIFF;
  const ex = new CollaborativeExecutor(fake, opts.cfg ?? CFG);
  return ex.run({
    taskDescription: 'Add a CLI command to export the report as CSV',
    executionPath: tmp,
    learningsRepoPath: tmp,
    getDiff: () => diff,
    improve: opts.improve
  });
}

/** Writes a package.json declaring a Playwright dev dependency into `dir`. */
function withPlaywright(dir: string): void {
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ devDependencies: { '@playwright/test': '^1.48.0' } })
  );
}

const UI_DIFF =
  'diff --git a/Button.tsx b/Button.tsx\n@@\n+<button>Go</button>';

describe('CollaborativeExecutor — Phase 4 improvement loop', () => {
  it('builds in-scope `now` items and surfaces `future` ideas, then ships', async () => {
    const { fake, counts } = makeFake([
      'IMPROVEMENT | ux | now | Show a spinner while the export runs\n' +
        'IMPROVEMENT | feature | future | Support exporting to XLSX as well\n' +
        'VERDICT: IMPROVE',
      'VERDICT: SHIP'
    ]);

    const res = await runLoop(fake, { improve: true });

    assert.equal(
      counts.productReviews,
      2,
      'reviewed twice (improve, then ship)'
    );
    assert.equal(
      counts.applyImprovements,
      1,
      'applied the one round of `now` items'
    );
    assert.match(
      counts.applyPrompts[0],
      /Show a spinner while the export runs/,
      'apply prompt carried the `now` item'
    );
    const surfaced = res.surfacedImprovements;
    assert.ok(surfaced, 'future ideas were surfaced');
    assert.match(surfaced, /Support exporting to XLSX/);
    assert.match(surfaced, /\[feature\]/);
    // `now` items are implemented, never surfaced as "future".
    assert.doesNotMatch(surfaced, /Show a spinner/);
  });

  it('ships immediately when the reviewer finds nothing in scope', async () => {
    const { fake, counts } = makeFake(['Looks complete.\nVERDICT: SHIP']);

    const res = await runLoop(fake, { improve: true });

    assert.equal(counts.productReviews, 1);
    assert.equal(counts.applyImprovements, 0, 'nothing applied');
    assert.equal(res.surfacedImprovements, undefined, 'nothing surfaced');
  });

  it('stops at maxImprovementRounds even if the reviewer keeps finding work', async () => {
    // Descriptions are deliberately dissimilar so stuck-detection does not fire
    // first — we want the safety cap to be the thing that stops the loop.
    const { fake, counts } = makeFake([
      'IMPROVEMENT | ux | now | Improve the wording of validation errors\nVERDICT: IMPROVE',
      'IMPROVEMENT | feature | now | Add keyboard shortcuts for list navigation\nVERDICT: IMPROVE',
      'IMPROVEMENT | ux | now | Persist the selected filters across page reloads\nVERDICT: IMPROVE',
      'IMPROVEMENT | ux | now | A fourth improvement that should never be reached\nVERDICT: IMPROVE'
    ]);

    await runLoop(fake, {
      improve: true,
      cfg: { ...CFG, maxImprovementRounds: 3 }
    });

    assert.equal(counts.productReviews, 3, 'capped at 3 review rounds');
    assert.equal(counts.applyImprovements, 3, 'applied each of the 3 rounds');
  });

  it('stops when the same `now` improvement resurfaces (stuck-detection)', async () => {
    const repeated =
      'IMPROVEMENT | ux | now | Add an empty state to the dashboard list\nVERDICT: IMPROVE';
    const { fake, counts } = makeFake([repeated, repeated, repeated]);

    await runLoop(fake, {
      improve: true,
      cfg: { ...CFG, maxImprovementRounds: 5 }
    });

    assert.equal(
      counts.productReviews,
      2,
      'reviewed, saw the repeat, then stopped'
    );
    assert.equal(
      counts.applyImprovements,
      1,
      'applied once; did not re-apply the identical item'
    );
  });

  it('skips the improvement loop entirely when there is no diff', async () => {
    const { fake, counts } = makeFake(['VERDICT: SHIP']);

    const res = await runLoop(fake, { improve: true, diff: '' });

    assert.equal(
      counts.productReviews,
      0,
      'no product review on an empty diff'
    );
    assert.equal(res.surfacedImprovements, undefined);
  });

  it('does not run Phase 4 at all in expert mode (improve falsy)', async () => {
    const { fake, counts } = makeFake([
      'IMPROVEMENT | ux | now | Should never be seen\nVERDICT: IMPROVE'
    ]);

    const res = await runLoop(fake, { improve: false });

    assert.equal(
      counts.productReviews,
      0,
      'improvement loop is loop-mode only'
    );
    assert.equal(counts.applyImprovements, 0);
    assert.equal(res.surfacedImprovements, undefined);
    // Expert phases still ran: design review + code review used the architect.
    assert.ok(counts.architectReviews >= 2, 'expert design + code review ran');
  });
});

describe('CollaborativeExecutor — Playwright UX probe', () => {
  it('activates when enabled + Playwright present + UI diff: probe prompt + command execution', async () => {
    const { fake, counts } = makeFake(['VERDICT: SHIP']);

    await runLoop(fake, {
      improve: true,
      diff: UI_DIFF,
      cfg: {
        ...CFG,
        uxProbe: {
          enabled: true,
          startCommand: 'npm run dev',
          url: 'http://localhost:3000'
        }
      },
      setupRepo: withPlaywright
    });

    assert.match(
      counts.lastProductPrompt,
      /Playwright/,
      'probe block injected'
    );
    assert.match(
      counts.lastProductPrompt,
      /npm run dev/,
      'start command included'
    );
    assert.equal(
      counts.lastProductPermission,
      'bypassPermissions',
      'probe turn can execute (still read-only for source)'
    );
  });

  it('stays a static review (plan mode) when the probe is disabled', async () => {
    const { fake, counts } = makeFake(['VERDICT: SHIP']);

    await runLoop(fake, {
      improve: true,
      diff: UI_DIFF,
      // uxProbe.enabled defaults to false in CFG
      setupRepo: withPlaywright
    });

    assert.doesNotMatch(counts.lastProductPrompt, /Playwright/);
    assert.equal(counts.lastProductPermission, 'plan');
  });

  it('does not activate when enabled but the repo lacks Playwright', async () => {
    const { fake, counts } = makeFake(['VERDICT: SHIP']);

    await runLoop(fake, {
      improve: true,
      diff: UI_DIFF,
      cfg: { ...CFG, uxProbe: { enabled: true, startCommand: 'npm run dev' } }
      // no setupRepo → no package.json / playwright config in the worktree
    });

    assert.doesNotMatch(counts.lastProductPrompt, /Playwright/);
    assert.equal(counts.lastProductPermission, 'plan');
  });

  it('does not activate for a backend-only diff even with Playwright present', async () => {
    const { fake, counts } = makeFake(['VERDICT: SHIP']);

    await runLoop(fake, {
      improve: true,
      diff: DIFF, // touches `f`, no UI extension
      cfg: { ...CFG, uxProbe: { enabled: true, startCommand: 'npm run dev' } },
      setupRepo: withPlaywright
    });

    assert.doesNotMatch(counts.lastProductPrompt, /Playwright/);
    assert.equal(counts.lastProductPermission, 'plan');
  });
});

describe('CollaborativeExecutor.parseImprovements', () => {
  // parseImprovements is private; access it directly for focused edge-case
  // coverage of the reviewer's output contract.
  const parse = (
    msg: string
  ): { now: string[]; future: string[]; ship: boolean } =>
    (
      new CollaborativeExecutor(makeFake([]).fake, CFG) as unknown as {
        parseImprovements: (m: string) => {
          now: string[];
          future: string[];
          ship: boolean;
        };
      }
    ).parseImprovements(msg);

  it('splits now/future and reads the verdict', () => {
    const r = parse(
      'IMPROVEMENT | feature | now | Add a --json flag\n' +
        'IMPROVEMENT | ux | future | Add pagination\n' +
        'VERDICT: IMPROVE'
    );
    assert.deepEqual(r.now, ['- [feature] Add a --json flag']);
    assert.deepEqual(r.future, ['- [ux] Add pagination']);
    assert.equal(r.ship, false);
  });

  it('is case-insensitive and trims trailing whitespace', () => {
    const r = parse(
      'improvement |  UX | NOW |  Tidy the help text   \nVERDICT: improve'
    );
    assert.deepEqual(r.now, ['- [ux] Tidy the help text']);
  });

  it('defaults to ship when the verdict is missing and there are no `now` items', () => {
    assert.equal(parse('Nothing to add here.').ship, true);
  });

  it('does not ship on a missing verdict when `now` items exist', () => {
    const r = parse('IMPROVEMENT | ux | now | Improve the error message');
    assert.equal(r.ship, false);
    assert.deepEqual(r.now, ['- [ux] Improve the error message']);
  });

  it('still surfaces `future` items even when the reviewer ships', () => {
    const r = parse(
      'IMPROVEMENT | feature | future | A big follow-up idea\nVERDICT: SHIP'
    );
    assert.equal(r.ship, true);
    assert.deepEqual(r.future, ['- [feature] A big follow-up idea']);
  });
});
