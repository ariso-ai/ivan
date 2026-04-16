import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const repoRoot = process.cwd();
const fixtureRoot = join(repoRoot, 'e2e');

describe('ivan learnings e2e fixture', () => {
  it('exposes a dry-run validator for the checked-in fixture', () => {
    const output = execFileSync(
      'node',
      ['scripts/test-learnings-e2e.mjs', '--dry-run'],
      {
        cwd: repoRoot,
        encoding: 'utf8'
      }
    );

    assert.match(output, /Dry run complete/i);
    assert.match(output, /ivan-e2e fixture/i);
    assert.match(output, /\.github\/workflows\/ivan-e2e\.yml/);
  });

  it('checks in the victim repo scaffold files described by the spec', () => {
    const requiredPaths = [
      '.github/workflows/ivan-e2e.yml',
      'docker-compose.yml',
      '.actrc',
      'package.json',
      'tsconfig.json',
      'src/math.ts',
      '.ivan/lessons.jsonl'
    ];

    for (const relativePath of requiredPaths) {
      assert.equal(
        existsSync(join(fixtureRoot, relativePath)),
        true,
        `Expected ${relativePath} to exist in e2e fixture`
      );
    }
  });

  it('defines the fail-fast workflow steps for learnings and issue execution', () => {
    const workflowPath = join(
      fixtureRoot,
      '.github',
      'workflows',
      'ivan-e2e.yml'
    );
    const workflow = readFileSync(workflowPath, 'utf8');

    assert.match(workflow, /OPEN_AI_KEY/);
    assert.match(workflow, /ANTHROPIC_KEY/);
    assert.match(workflow, /\bPAT\b/);
    assert.match(workflow, /gh issue create/);
    assert.match(workflow, /gh issue delete/);
    assert.match(workflow, /ivan learnings init/);
    assert.match(workflow, /ivan learnings ingest-repo/);
    assert.match(workflow, /ivan learnings rebuild/);
    assert.match(workflow, /ivan learnings query/);
    assert.match(workflow, /ivan learnings install-hooks/);
    assert.match(workflow, /tsc --noEmit/);
    assert.match(workflow, /if: always\(\)/);
  });
});
