/**
 * Unit tests for the Codex CLI executor support added in the "Support codex" PR.
 *
 * Covers:
 *   - ConfigManager.getExecutorType()  → now accepts 'codex'
 *   - ConfigManager.getCodexModel()    → returns undefined when unset, value when set
 *   - ConfigManager.getCollaborativeConfig() → architectModel falls back to codexModel
 *     when executorType is 'codex'
 *   - ExecutorFactory.getExecutor()    → returns CodexCliExecutor for 'codex'
 *   - CodexCliExecutor.validateClaudeCodeInstallation() → throws a helpful error
 *     when the codex binary is absent (fully offline)
 *   - CodexCliExecutor.composePrompt() → system prompt is prepended to user prompt
 *   - CLI help: configure-executor and choose-model commands list Codex as an option
 *
 * Runs offline with node:test + node:assert (no external services needed).
 * Run via: npx tsx --test src/__tests__/codex-support.test.ts
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const configDir = path.join(os.homedir(), '.ivan');
const configPath = path.join(configDir, 'config.json');

/** Write a minimal config JSON and return the previous content (or null). */
function writeConfig(partial: Record<string, unknown>): string | null {
  if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
  const previous = fs.existsSync(configPath)
    ? fs.readFileSync(configPath, 'utf8')
    : null;
  // Merge with the minimum fields ConfigManager expects so isConfigured() returns true
  const base: Record<string, unknown> = {
    openaiApiKey: 'test-openai',
    anthropicApiKey: 'test-anthropic',
    version: '1.0.0'
  };
  fs.writeFileSync(configPath, JSON.stringify({ ...base, ...partial }), 'utf8');
  return previous;
}

/** Restore config to its prior state. */
function restoreConfig(previous: string | null): void {
  if (previous === null) {
    if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
  } else {
    fs.writeFileSync(configPath, previous, 'utf8');
  }
}

// ---------------------------------------------------------------------------
// ConfigManager — getExecutorType with 'codex'
// ---------------------------------------------------------------------------

describe('ConfigManager — codex executor type', () => {
  let savedConfig: string | null;

  before(() => {
    savedConfig = writeConfig({ executorType: 'codex' });
  });

  after(() => {
    restoreConfig(savedConfig);
  });

  it('getExecutorType() returns "codex" when saved in config', async () => {
    const { ConfigManager } = await import('../config.js');
    const cm = new ConfigManager();
    assert.strictEqual(
      cm.getExecutorType(),
      'codex',
      'Expected executor type to be "codex"'
    );
  });

  it('getCodexModel() returns undefined when codexModel is not set', async () => {
    const { ConfigManager } = await import('../config.js');
    const cm = new ConfigManager();
    assert.strictEqual(
      cm.getCodexModel(),
      undefined,
      'Expected codexModel to be undefined when absent'
    );
  });

  it('getCodexModel() returns the configured model when set', async () => {
    savedConfig = writeConfig({
      executorType: 'codex',
      codexModel: 'gpt-5-codex'
    });
    const { ConfigManager } = await import('../config.js');
    const cm = new ConfigManager();
    assert.strictEqual(
      cm.getCodexModel(),
      'gpt-5-codex',
      'Expected getCodexModel() to return the saved model string'
    );
  });

  it('getCodexModel() trims whitespace and returns undefined for blank strings', async () => {
    savedConfig = writeConfig({ executorType: 'codex', codexModel: '   ' });
    const { ConfigManager } = await import('../config.js');
    const cm = new ConfigManager();
    assert.strictEqual(
      cm.getCodexModel(),
      undefined,
      'A whitespace-only codexModel should resolve to undefined'
    );
  });
});

// ---------------------------------------------------------------------------
// ConfigManager — getCollaborativeConfig with executorType 'codex'
// ---------------------------------------------------------------------------

describe('ConfigManager.getCollaborativeConfig() — codex executor', () => {
  let savedConfig: string | null;

  after(() => {
    restoreConfig(savedConfig);
  });

  it('architectModel defaults to empty string when codexModel is unset', async () => {
    savedConfig = writeConfig({ executorType: 'codex' });
    const { ConfigManager } = await import('../config.js');
    const cm = new ConfigManager();
    const cfg = cm.getCollaborativeConfig();
    assert.strictEqual(
      cfg.architectModel,
      '',
      'When executorType is "codex" and no codexModel is set, architectModel should be ""'
    );
  });

  it('architectModel inherits codexModel when set', async () => {
    savedConfig = writeConfig({
      executorType: 'codex',
      codexModel: 'gpt-5-codex'
    });
    const { ConfigManager } = await import('../config.js');
    const cm = new ConfigManager();
    const cfg = cm.getCollaborativeConfig();
    assert.strictEqual(
      cfg.architectModel,
      'gpt-5-codex',
      'When executorType is "codex", architectModel should inherit codexModel'
    );
  });

  it('architectModel falls back to claude-opus-4-8 for sdk executor', async () => {
    savedConfig = writeConfig({ executorType: 'sdk' });
    const { ConfigManager } = await import('../config.js');
    const cm = new ConfigManager();
    const cfg = cm.getCollaborativeConfig();
    assert.strictEqual(
      cfg.architectModel,
      'claude-opus-4-8',
      'For SDK executor, architectModel should default to claude-opus-4-8'
    );
  });

  it('collaborative.architectModel override is respected regardless of executor', async () => {
    savedConfig = writeConfig({
      executorType: 'codex',
      codexModel: 'gpt-5-codex',
      collaborative: { architectModel: 'o3-mini', maxDesignRounds: 2 }
    });
    const { ConfigManager } = await import('../config.js');
    const cm = new ConfigManager();
    const cfg = cm.getCollaborativeConfig();
    assert.strictEqual(
      cfg.architectModel,
      'o3-mini',
      'Explicit collaborative.architectModel should override the codexModel default'
    );
    assert.strictEqual(cfg.maxDesignRounds, 2);
  });
});

// ---------------------------------------------------------------------------
// ExecutorFactory — returns CodexCliExecutor for 'codex'
// ---------------------------------------------------------------------------

describe('ExecutorFactory.getExecutor()', () => {
  let savedConfig: string | null;

  after(() => {
    restoreConfig(savedConfig);
  });

  it('returns an instance with executeTask / executeTurn for "codex"', async () => {
    savedConfig = writeConfig({ executorType: 'codex' });
    const { ExecutorFactory } = await import('../services/executor-factory.js');
    const executor = ExecutorFactory.getExecutor();
    assert.ok(
      typeof executor.executeTask === 'function',
      'CodexCliExecutor should implement executeTask'
    );
    assert.ok(
      typeof executor.executeTurn === 'function',
      'CodexCliExecutor should implement executeTurn'
    );
    assert.ok(
      typeof executor.validateClaudeCodeInstallation === 'function',
      'CodexCliExecutor should implement validateClaudeCodeInstallation'
    );
    assert.ok(
      typeof executor.generateTaskBreakdown === 'function',
      'CodexCliExecutor should implement generateTaskBreakdown'
    );
  });

  it('returns a different executor class for "sdk"', async () => {
    savedConfig = writeConfig({ executorType: 'sdk' });
    const { ExecutorFactory } = await import('../services/executor-factory.js');
    const { CodexCliExecutor } =
      await import('../services/codex-cli-executor.js');
    const executor = ExecutorFactory.getExecutor();
    assert.ok(
      !(executor instanceof CodexCliExecutor),
      'SDK executor should not be a CodexCliExecutor'
    );
  });

  it('returns CodexCliExecutor instance for "codex"', async () => {
    savedConfig = writeConfig({ executorType: 'codex' });
    const { ExecutorFactory } = await import('../services/executor-factory.js');
    const { CodexCliExecutor } =
      await import('../services/codex-cli-executor.js');
    const executor = ExecutorFactory.getExecutor();
    assert.ok(
      executor instanceof CodexCliExecutor,
      'Executor factory should return a CodexCliExecutor for executorType "codex"'
    );
  });
});

// ---------------------------------------------------------------------------
// CodexCliExecutor — validateClaudeCodeInstallation error path (offline)
// ---------------------------------------------------------------------------

describe('CodexCliExecutor.validateClaudeCodeInstallation()', () => {
  it('throws a meaningful error when the codex binary is not on PATH', async () => {
    const { CodexCliExecutor } =
      await import('../services/codex-cli-executor.js');
    const executor = new CodexCliExecutor();
    executor.quietMode = true;

    // Temporarily shadow PATH so `which codex` fails deterministically
    const originalPath = process.env.PATH;
    process.env.PATH = '';
    try {
      await assert.rejects(
        async () => executor.validateClaudeCodeInstallation(),
        (err: Error) => {
          assert.ok(
            err.message.includes('Codex CLI is not installed'),
            `Expected error about missing Codex CLI, got: ${err.message}`
          );
          assert.ok(
            err.message.includes('npm install -g @openai/codex') ||
              err.message.includes('brew install codex'),
            `Expected install instruction in error, got: ${err.message}`
          );
          return true;
        }
      );
    } finally {
      process.env.PATH = originalPath;
    }
  });
});

// ---------------------------------------------------------------------------
// CodexCliExecutor — composePrompt (system prompt prepending)
// ---------------------------------------------------------------------------

describe('CodexCliExecutor — composePrompt', () => {
  it('returns the user prompt unchanged when no system prompt is given', async () => {
    const { CodexCliExecutor } =
      await import('../services/codex-cli-executor.js');
    const executor = new CodexCliExecutor();
    // composePrompt is private; access via cast to any for the test
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (executor as any).composePrompt('do the thing');
    assert.strictEqual(result, 'do the thing');
  });

  it('prepends system instructions when a system prompt is provided', async () => {
    const { CodexCliExecutor } =
      await import('../services/codex-cli-executor.js');
    const executor = new CodexCliExecutor();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (executor as any).composePrompt(
      'do the thing',
      'You are a helpful assistant.'
    );
    assert.ok(
      result.startsWith('<system_instructions>'),
      'Composed prompt should open with <system_instructions>'
    );
    assert.ok(
      result.includes('You are a helpful assistant.'),
      'System prompt content should appear in the composed prompt'
    );
    assert.ok(
      result.includes('do the thing'),
      'User prompt should appear in the composed prompt'
    );
    // System block must come before the user prompt
    assert.ok(
      result.indexOf('<system_instructions>') < result.indexOf('do the thing'),
      'System instructions should precede the user prompt'
    );
  });

  it('wraps system instructions in the expected XML tags', async () => {
    const { CodexCliExecutor } =
      await import('../services/codex-cli-executor.js');
    const executor = new CodexCliExecutor();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (executor as any).composePrompt('task', 'sys');
    assert.match(
      result,
      /^<system_instructions>\nsys\n<\/system_instructions>/,
      'System prompt must be wrapped in <system_instructions> XML tags'
    );
  });
});

// ---------------------------------------------------------------------------
// CLI integration — Codex appears in configure-executor / choose-model help
// ---------------------------------------------------------------------------

describe('CLI help — Codex executor visible in command output', () => {
  const cliPath = path.join(process.cwd(), 'dist', 'index.js');

  it('--help output lists configure-executor command', () => {
    const output = execSync(`node ${cliPath} --help`, { encoding: 'utf-8' });
    assert.ok(
      output.includes('configure-executor'),
      '--help should list the configure-executor command'
    );
  });

  it('--help output lists choose-model command', () => {
    const output = execSync(`node ${cliPath} --help`, { encoding: 'utf-8' });
    assert.ok(
      output.includes('choose-model'),
      '--help should list the choose-model command'
    );
  });

  it('configure-executor description mentions Codex CLI', () => {
    const output = execSync(`node ${cliPath} --help`, { encoding: 'utf-8' });
    assert.ok(
      output.toLowerCase().includes('codex'),
      '--help configure-executor description should mention Codex'
    );
  });

  it('choose-model description mentions Codex or coding agent', () => {
    const output = execSync(`node ${cliPath} --help`, { encoding: 'utf-8' });
    assert.ok(
      output.toLowerCase().includes('codex') ||
        output.toLowerCase().includes('coding agent'),
      '--help choose-model description should mention Codex or coding agent'
    );
  });
});
