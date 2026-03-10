import { afterEach, describe, expect, test } from '@jest/globals';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { rebuildLearningsDatabase } from '../dist/learnings/builder.js';
import { loadCanonicalRecords } from '../dist/learnings/parser.js';
import { queryLearnings } from '../dist/learnings/query.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const fixtureRoot = path.join(__dirname, 'fixtures', 'sample-repo');
const tempRoots = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    const tempRoot = tempRoots.pop();
    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
});

describe('learnings storage slice', () => {
  test('parses canonical records from fixture files', () => {
    const repoPath = copyFixtureRepo();
    const dataset = loadCanonicalRecords(repoPath);

    expect(dataset.repositories).toHaveLength(1);
    expect(dataset.evidence).toHaveLength(2);
    expect(dataset.learnings).toHaveLength(1);
    expect(dataset.learnings[0].statement).toBe(
      'Avoid holding locks across awaits or other blocking operations.'
    );
    expect(dataset.learnings[0].evidence_ids).toEqual([
      'ev_lock-await',
      'ev_lock-await-ack'
    ]);
  });

  test('rebuilds learnings.db and returns evidence-backed query results', () => {
    const repoPath = copyFixtureRepo();
    const result = rebuildLearningsDatabase(repoPath);
    const queryResults = queryLearnings(repoPath, 'locks await', { limit: 2 });

    expect(fs.existsSync(result.dbPath)).toBe(true);
    expect(result.repositoryCount).toBe(1);
    expect(result.evidenceCount).toBe(2);
    expect(result.learningCount).toBe(1);
    expect(queryResults).toHaveLength(1);
    expect(queryResults[0].statement).toContain('Avoid holding locks across awaits');
    expect(queryResults[0].evidence.map((evidence) => evidence.id)).toEqual([
      'ev_lock-await',
      'ev_lock-await-ack'
    ]);
  });

  test('initializes learnings storage through the CLI', () => {
    const repoPath = createEmptyRepo('init-repo');

    execIvan(['learnings', 'init', '--repo', repoPath]);

    expect(
      fs.existsSync(
        path.join(
          repoPath,
          'learnings',
          'repositories',
          'repo_init-repo.yaml'
        )
      )
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(repoPath, 'learnings', 'evidence', 'repo_init-repo')
      )
    ).toBe(true);
    expect(
      fs.readFileSync(path.join(repoPath, '.gitignore'), 'utf8')
    ).toContain('learnings.db');
  });

  test('rebuild and query commands work end to end via CLI', () => {
    const repoPath = copyFixtureRepo();

    execIvan(['learnings', 'rebuild', '--repo', repoPath]);
    const output = execIvan([
      'learnings',
      'query',
      '--repo',
      repoPath,
      '--text',
      'locks await'
    ]);

    expect(output).toContain('Avoid holding locks across awaits');
    expect(output).toContain('ev_lock-await');
    expect(output).toContain('ev_lock-await-ack');
  });
});

function createEmptyRepo(name) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ivan-learnings-'));
  const repoPath = path.join(tempRoot, name);
  fs.mkdirSync(repoPath);
  tempRoots.push(tempRoot);

  return repoPath;
}

function copyFixtureRepo() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ivan-learnings-'));
  const repoPath = path.join(tempRoot, 'sample-repo');
  fs.cpSync(fixtureRoot, repoPath, { recursive: true });
  tempRoots.push(tempRoot);

  return repoPath;
}

function execIvan(args) {
  return execFileSync('node', ['dist/index.js', ...args], {
    cwd: projectRoot,
    encoding: 'utf8'
  });
}
