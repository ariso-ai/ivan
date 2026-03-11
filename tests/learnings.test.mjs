import { afterEach, describe, expect, test } from '@jest/globals';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { rebuildLearningsDatabase } from '../dist/learnings/builder.js';
import { buildEvidenceRecordsFromPullRequest } from '../dist/learnings/evidence-writer.js';
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
        path.join(repoPath, 'learnings', 'repositories.jsonl')
      )
    ).toBe(true);
    expect(
      fs.existsSync(path.join(repoPath, 'learnings', 'evidence'))
    ).toBe(true);
    expect(
      fs.existsSync(path.join(repoPath, 'learnings', 'lessons'))
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

  test('install-hooks writes the three Claude hook integrations idempotently', () => {
    const repoPath = createEmptyRepo('hooks-repo');

    execIvan(['learnings', 'install-hooks', '--repo', repoPath]);
    execIvan(['learnings', 'install-hooks', '--repo', repoPath]);

    const settingsPath = path.join(repoPath, '.claude', 'settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));

    expect(
      fs.existsSync(
        path.join(repoPath, '.claude', 'hooks', 'ivan-learnings-user-prompt.sh')
      )
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(repoPath, '.claude', 'hooks', 'ivan-learnings-post-edit.sh')
      )
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(repoPath, '.claude', 'hooks', 'ivan-learnings-stop.sh')
      )
    ).toBe(true);

    expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
    expect(settings.hooks.PostToolUse).toHaveLength(1);
    expect(settings.hooks.Stop).toHaveLength(1);
    expect(settings.hooks.PostToolUse[0].matcher).toBe(
      'Edit|Write|MultiEdit'
    );
    expect(settings.hooks.UserPromptSubmit[0].hooks[0].command).toContain(
      'ivan-learnings-user-prompt.sh'
    );
    expect(settings.hooks.PostToolUse[0].hooks[0].command).toContain(
      'ivan-learnings-post-edit.sh'
    );
    expect(settings.hooks.Stop[0].hooks[0].command).toContain(
      'ivan-learnings-stop.sh'
    );
  });

  test('maps GitHub PR evidence into deterministic canonical evidence records', () => {
    const records = buildEvidenceRecordsFromPullRequest('repo_sample-repo', {
      repository: {
        owner: 'ariso-ai',
        name: 'ivan'
      },
      pullRequest: {
        number: 15,
        title: 'Fix prompt routing',
        body: 'Ensures -p stays before greedy flags.',
        url: 'https://github.com/ariso-ai/ivan/pull/15',
        state: 'OPEN',
        headRefName: 'fix/prompt-routing',
        author: { login: 'michaelgeiger' }
      },
      issueComments: [
        {
          id: 'c1',
          body: 'Can we make this safer around disallowed tools?',
          createdAt: '2026-03-09T00:00:00Z',
          author: { login: 'reviewer1' }
        }
      ],
      reviews: [
        {
          id: 'r1',
          body: 'Needs to keep prompt ahead of the multi-value flags.',
          state: 'CHANGES_REQUESTED',
          submittedAt: '2026-03-09T01:00:00Z',
          author: { login: 'reviewer2' }
        }
      ],
      reviewThreads: [
        {
          id: 't1',
          isResolved: false,
          isOutdated: false,
          comments: [
            {
              id: 'tc1',
              databaseId: 101,
              body: 'This inline comment explains the parsing failure.',
              createdAt: '2026-03-09T02:00:00Z',
              author: { login: 'reviewer3' },
              path: 'src/services/claude-cli-executor.ts',
              line: 129
            }
          ]
        }
      ],
      files: [
        {
          path: 'src/services/claude-cli-executor.ts',
          additions: 3,
          deletions: 1,
          changeType: 'modified'
        }
      ],
      checks: [
        {
          name: 'lint',
          state: 'FAILURE'
        }
      ]
    });

    expect(records.map((record) => record.source_type)).toEqual([
      'pr_check',
      'pr_issue_comment',
      'pr_review',
      'pr_review_thread',
      'pull_request'
    ]);
    expect(records.every((record) => record.id.startsWith('ev_'))).toBe(true);
    expect(records.find((record) => record.source_type === 'pr_review')?.boosts).toContain(
      'changes_requested'
    );
    expect(
      records.find((record) => record.source_type === 'pr_review_thread')
        ?.resolution_state
    ).toBe('unresolved');
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
