import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { SelfReviewExecutor } from './self-review-executor.js';
import type {
  IClaudeExecutor,
  TurnResult,
  TurnOptions
} from './executor-factory.js';
import type { SelfReviewConfig } from '../config.js';

/**
 * Offline tests for the pre-PR self review via the IClaudeExecutor seam — no
 * Claude, git, or network. learningsRepoPath is an empty temp dir, so the
 * learnings query throws (missing store), buildBrief swallows it, and no
 * embedding/network call is reached.
 */

const DIFF = 'diff --git a/f b/f\n@@\n+const x = 1;';

interface Call {
  prompt: string;
  options: TurnOptions;
}

function makeFake(reviewText: string): {
  fake: IClaudeExecutor;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fake: IClaudeExecutor = {
    quietMode: true,
    async executeTurn(
      prompt: string,
      _dir: string,
      options: TurnOptions = {}
    ): Promise<TurnResult> {
      calls.push({ prompt, options });
      // The review turn carries the reviewer system prompt; the fix turn doesn't.
      const isReview = (options.systemPrompt ?? '').includes(
        'pre-merge code review'
      );
      const text = isReview ? reviewText : 'applied fixes';
      return {
        log: text,
        lastMessage: text,
        sessionId: options.sessionId ?? 'reviewer'
      };
    },
    async executeTask(): Promise<TurnResult> {
      return { log: '', lastMessage: '', sessionId: '' };
    },
    async generateTaskBreakdown(): Promise<string[]> {
      return [];
    },
    async validateClaudeCodeInstallation(): Promise<void> {}
  };
  return { fake, calls };
}

function runReview(
  fake: IClaudeExecutor,
  opts: {
    reviewText?: string;
    diff?: string;
    model?: string;
    implementerSessionId?: string;
  } = {}
) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ivan-selfreview-'));
  const config: SelfReviewConfig = {
    enabled: true,
    ...(opts.model ? { model: opts.model } : {})
  };
  const ex = new SelfReviewExecutor(fake, config);
  return ex.run({
    diff: opts.diff ?? DIFF,
    executionPath: tmp,
    learningsRepoPath: tmp,
    implementerSessionId: opts.implementerSessionId
  });
}

describe('SelfReviewExecutor', () => {
  it('applies a fix turn when the reviewer requests changes', async () => {
    const { fake, calls } = makeFake(
      'Line 12 leaks a file handle; close it.\nVERDICT: CHANGES_REQUESTED'
    );

    const res = await runReview(fake, { implementerSessionId: 'impl-123' });

    assert.equal(res.changesRequested, true);
    assert.equal(calls.length, 2, 'review turn + fix turn');

    // Review turn: read-only, plan mode, reviewer persona.
    assert.equal(calls[0].options.readOnly, true);
    assert.equal(calls[0].options.permissionMode, 'plan');
    assert.match(calls[0].options.systemPrompt ?? '', /pre-merge code review/);

    // Fix turn: resumes the implementer session with edit permissions.
    assert.equal(calls[1].options.permissionMode, 'bypassPermissions');
    assert.equal(calls[1].options.sessionId, 'impl-123');
    assert.notEqual(calls[1].options.readOnly, true);
    assert.match(calls[1].prompt, /asked for the following fixes/);
  });

  it('does nothing to the code when the reviewer says LGTM', async () => {
    const { fake, calls } = makeFake('Looks good.\nVERDICT: LGTM');

    const res = await runReview(fake);

    assert.equal(res.changesRequested, false);
    assert.equal(calls.length, 1, 'review turn only; no fix turn');
  });

  it('treats a missing/malformed verdict as LGTM (never an unbounded fix)', async () => {
    const { fake, calls } = makeFake(
      'I have some vague thoughts but no verdict.'
    );

    const res = await runReview(fake);

    assert.equal(res.changesRequested, false);
    assert.equal(calls.length, 1);
  });

  it('skips the review entirely when there is no diff', async () => {
    const { fake, calls } = makeFake('VERDICT: CHANGES_REQUESTED');

    const res = await runReview(fake, { diff: '   ' });

    assert.equal(res.changesRequested, false);
    assert.equal(res.reviewLog, '');
    assert.equal(calls.length, 0, 'no turns run on an empty diff');
  });

  it('honors the reviewer model override on the review turn', async () => {
    const { fake, calls } = makeFake('VERDICT: LGTM');

    await runReview(fake, { model: 'claude-opus-4-8' });

    assert.equal(calls[0].options.model, 'claude-opus-4-8');
  });

  it('defaults the review turn to the configured model (no override)', async () => {
    const { fake, calls } = makeFake('VERDICT: LGTM');

    await runReview(fake);

    assert.equal(calls[0].options.model, undefined);
  });
});
