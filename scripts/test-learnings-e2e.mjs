#!/usr/bin/env node

import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const fixtureRoot = path.join(projectRoot, 'tests', 'fixtures', 'sample-repo');
const tempRoots = [];
const keepTemp = process.argv.includes('--keep-temp');
const nodeEnv = {
  ...process.env,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? 'sk-test'
};

try {
  section('Pre-flight');
  run('npm', ['run', 'typecheck']);
  run('npm', ['run', 'lint']);

  section('Automated Tests');
  run('npm', ['test']);

  section('Manual CLI E2E');
  const emptyRepoPath = createEmptyRepo('ivan-learnings-empty-repo');
  verifyPristineLifecycleFlow(emptyRepoPath);

  const sampleRepoPath = createEmptyRepo('sample-repo');
  verifySeededQueryFlow(sampleRepoPath);

  section('Summary');
  console.log('E2E verification passed.');
  console.log(`Empty repo sandbox: ${emptyRepoPath}`);
  console.log(`Sample repo sandbox: ${sampleRepoPath}`);
  if (!keepTemp) {
    console.log('Temporary sandboxes removed.');
  }
} catch (error) {
  console.error('\nE2E verification failed.');
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(String(error));
  }
  process.exitCode = 1;
} finally {
  if (!keepTemp) {
    cleanupTempRoots();
  }
}

function verifyPristineLifecycleFlow(repoPath) {
  console.log(`Using pristine lifecycle sandbox: ${repoPath}`);
  resetToPristineState(repoPath);
  assertPristineState(repoPath);

  runIvan(['learnings', 'init', '--repo', repoPath]);
  assertExists(path.join(repoPath, '.ivan', 'evidence.jsonl'));
  assertExists(path.join(repoPath, '.ivan', 'lessons.jsonl'));

  runIvan(['learnings', 'install-hooks', '--repo', repoPath]);
  assertExists(
    path.join(repoPath, '.claude', 'hooks', 'ivan-learnings-user-prompt.sh')
  );
  assertExists(
    path.join(repoPath, '.claude', 'hooks', 'ivan-learnings-post-edit.sh')
  );

  const rebuildOutput = runIvan(['learnings', 'rebuild', '--repo', repoPath]);
  assertIncludes(rebuildOutput, 'Learnings database rebuilt');
  assertExists(path.join(repoPath, '.ivan', 'db.sqlite'));

  const queryOutput = runIvan([
    'learnings',
    'query',
    '--repo',
    repoPath,
    '--text',
    'locks await',
    '--limit',
    '3'
  ]);
  assertIncludes(queryOutput, 'No learnings matched that query.');
}

function verifySeededQueryFlow(repoPath) {
  console.log(`Using seeded query sandbox: ${repoPath}`);
  resetToPristineState(repoPath);
  assertPristineState(repoPath);

  seedCanonicalLearnings(repoPath);

  runIvan(['learnings', 'install-hooks', '--repo', repoPath]);
  assertExists(
    path.join(repoPath, '.claude', 'hooks', 'ivan-learnings-user-prompt.sh')
  );
  assertExists(
    path.join(repoPath, '.claude', 'hooks', 'ivan-learnings-post-edit.sh')
  );

  const rebuildOutput = runIvan(['learnings', 'rebuild', '--repo', repoPath]);
  assertIncludes(rebuildOutput, 'Learnings database rebuilt');
  assertIncludes(rebuildOutput, 'Repositories: 1, evidence: 2, learnings: 1');

  const queryOutput = runIvan([
    'learnings',
    'query',
    '--repo',
    repoPath,
    '--text',
    'locks await',
    '--limit',
    '3'
  ]);
  assertIncludes(
    queryOutput,
    'Avoid holding locks across awaits or other blocking operations.'
  );
  assertIncludes(queryOutput, 'ev_lock-await');
  assertIncludes(queryOutput, 'ev_lock-await-ack');
}

function runIvan(args) {
  return run('node', ['dist/index.js', ...args], { capture: true });
}

function run(command, args, options = {}) {
  const { capture = false } = options;
  const execOptions = {
    cwd: projectRoot,
    env: nodeEnv,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
  };

  if (capture) {
    return execFileSync(command, args, execOptions);
  }

  execFileSync(command, args, execOptions);
  return '';
}

function createEmptyRepo(name) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ivan-learnings-e2e-'));
  tempRoots.push(tempRoot);
  const repoPath = path.join(tempRoot, name);
  fs.mkdirSync(repoPath, { recursive: true });
  return repoPath;
}

function resetToPristineState(repoPath) {
  fs.rmSync(path.join(repoPath, '.ivan'), { recursive: true, force: true });
  fs.rmSync(path.join(repoPath, '.claude', 'cache'), {
    recursive: true,
    force: true
  });
  fs.rmSync(path.join(repoPath, '.claude', 'hooks', 'logs'), {
    recursive: true,
    force: true
  });
  fs.rmSync(path.join(repoPath, '.claude', 'hooks', 'ivan-learnings-user-prompt.sh'), {
    force: true
  });
  fs.rmSync(path.join(repoPath, '.claude', 'hooks', 'ivan-learnings-post-edit.sh'), {
    force: true
  });
  fs.rmSync(path.join(repoPath, '.claude', 'hooks', 'ivan-learnings-stop.sh'), {
    force: true
  });

  removeIvanHookEntries(path.join(repoPath, '.claude', 'settings.json'));
  removeEmptyClaudeDirectories(repoPath);
}

function seedCanonicalLearnings(repoPath) {
  const sourceIvanPath = path.join(fixtureRoot, '.ivan');
  const targetIvanPath = path.join(repoPath, '.ivan');
  fs.mkdirSync(targetIvanPath, { recursive: true });
  fs.copyFileSync(
    path.join(sourceIvanPath, 'evidence.jsonl'),
    path.join(targetIvanPath, 'evidence.jsonl')
  );
  fs.copyFileSync(
    path.join(sourceIvanPath, 'lessons.jsonl'),
    path.join(targetIvanPath, 'lessons.jsonl')
  );
}

function assertPristineState(repoPath) {
  assertNotExists(path.join(repoPath, '.ivan'));
  assertNotExists(path.join(repoPath, '.claude', 'cache'));
  assertNotExists(path.join(repoPath, '.claude', 'hooks', 'logs'));
  assertNotExists(
    path.join(repoPath, '.claude', 'hooks', 'ivan-learnings-user-prompt.sh')
  );
  assertNotExists(
    path.join(repoPath, '.claude', 'hooks', 'ivan-learnings-post-edit.sh')
  );
  assertNotExists(
    path.join(repoPath, '.claude', 'hooks', 'ivan-learnings-stop.sh')
  );

  const settingsPath = path.join(repoPath, '.claude', 'settings.json');
  if (!fs.existsSync(settingsPath)) {
    return;
  }

  const raw = fs.readFileSync(settingsPath, 'utf8').trim();
  if (!raw) {
    return;
  }

  const settings = JSON.parse(raw);
  const hookGroups = settings.hooks ?? {};
  for (const entries of Object.values(hookGroups)) {
    if (!Array.isArray(entries)) {
      continue;
    }

    for (const entry of entries) {
      const hooks = Array.isArray(entry?.hooks) ? entry.hooks : [];
      for (const hook of hooks) {
        if (typeof hook?.command === 'string' && hook.command.includes('ivan-learnings')) {
          throw new Error(`Expected pristine Claude settings without Ivan hooks: ${settingsPath}`);
        }
      }
    }
  }
}

function removeIvanHookEntries(settingsPath) {
  if (!fs.existsSync(settingsPath)) {
    return;
  }

  const raw = fs.readFileSync(settingsPath, 'utf8').trim();
  if (!raw) {
    fs.rmSync(settingsPath, { force: true });
    return;
  }

  const settings = JSON.parse(raw);
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new Error(`Expected ${settingsPath} to contain a JSON object`);
  }

  const hooks = settings.hooks;
  if (hooks && typeof hooks === 'object' && !Array.isArray(hooks)) {
    for (const [hookName, entries] of Object.entries(hooks)) {
      if (!Array.isArray(entries)) {
        continue;
      }

      const filteredEntries = entries.filter((entry) => {
        const commands = Array.isArray(entry?.hooks) ? entry.hooks : [];
        return !commands.some(
          (hook) =>
            typeof hook?.command === 'string' &&
            hook.command.includes('ivan-learnings')
        );
      });

      if (filteredEntries.length === 0) {
        delete hooks[hookName];
      } else {
        hooks[hookName] = filteredEntries;
      }
    }

    if (Object.keys(hooks).length === 0) {
      delete settings.hooks;
    }
  }

  if (Object.keys(settings).length === 0) {
    fs.rmSync(settingsPath, { force: true });
    return;
  }

  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}

function removeEmptyClaudeDirectories(repoPath) {
  const hooksDir = path.join(repoPath, '.claude', 'hooks');
  const claudeDir = path.join(repoPath, '.claude');

  if (fs.existsSync(hooksDir) && fs.readdirSync(hooksDir).length === 0) {
    fs.rmdirSync(hooksDir);
  }

  if (fs.existsSync(claudeDir) && fs.readdirSync(claudeDir).length === 0) {
    fs.rmdirSync(claudeDir);
  }
}

function cleanupTempRoots() {
  while (tempRoots.length > 0) {
    const tempRoot = tempRoots.pop();
    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

function assertExists(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Expected path to exist: ${filePath}`);
  }
}

function assertNotExists(filePath) {
  if (fs.existsSync(filePath)) {
    throw new Error(`Expected path not to exist: ${filePath}`);
  }
}

function assertIncludes(text, expected) {
  if (!text.includes(expected)) {
    throw new Error(`Expected output to include: ${expected}`);
  }
}

function section(title) {
  console.log(`\n== ${title} ==`);
}
