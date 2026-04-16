#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = process.cwd();
const fixtureRoot = resolve(repoRoot, 'e2e');
const args = new Set(process.argv.slice(2));
const isDryRun = args.has('--dry-run');

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
  const absolutePath = join(fixtureRoot, relativePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Missing required ivan-e2e fixture file: ${relativePath}`);
  }
}

const workflowPath = join(fixtureRoot, '.github', 'workflows', 'ivan-e2e.yml');
const workflow = readFileSync(workflowPath, 'utf8');
for (const snippet of [
  'OPEN_AI_KEY',
  'ANTHROPIC_KEY',
  'PAT',
  'gh issue create',
  'gh issue delete',
  'ivan learnings init',
  'ivan learnings ingest-repo',
  'ivan learnings rebuild',
  'ivan learnings query',
  'ivan learnings install-hooks',
  'tsc --noEmit',
  'if: always()'
]) {
  if (!workflow.includes(snippet)) {
    throw new Error(`Workflow is missing required snippet: ${snippet}`);
  }
}

if (isDryRun) {
  console.log('ivan-e2e fixture validated');
  console.log(`Fixture root: ${fixtureRoot}`);
  console.log(`Workflow: ${workflowPath}`);
  console.log('Dry run complete');
  process.exit(0);
}

const dockerResult = spawnSync('docker', ['compose', 'up', '--abort-on-container-exit'], {
  cwd: fixtureRoot,
  stdio: 'inherit'
});

if (dockerResult.error) {
  throw dockerResult.error;
}

process.exit(dockerResult.status ?? 1);
