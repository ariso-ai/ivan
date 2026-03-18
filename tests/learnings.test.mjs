import { afterEach, beforeAll, describe, expect, jest, test } from '@jest/globals';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

// Deterministic fake embedding: same input always yields the same 1536-dim unit vector.
// Allows rebuild/query tests to run without hitting the OpenAI API.
function deterministicEmbedding(text) {
  const dim = 1536;
  const vec = new Array(dim).fill(0);
  for (let i = 0; i < text.length; i++) {
    vec[i % dim] += text.charCodeAt(i);
  }
  const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / mag);
}

// Must be called before any dynamic import that resolves openai
jest.unstable_mockModule('openai', () => ({
  default: class OpenAIMock {
    embeddings = {
      create: async ({ input }) => {
        const texts = Array.isArray(input) ? input : [input];
        return {
          data: texts.map((text, index) => ({ index, embedding: deterministicEmbedding(text) }))
        };
      }
    };

    chat = {
      completions: {
        create: async ({ messages }) => {
          // Parse evidence_id lines from the user message and return a generic lesson per item.
          const userContent = messages.find((m) => m.role === 'user')?.content ?? '';
          const evidenceIds = [...userContent.matchAll(/^evidence_id: (.+)$/gm)].map(
            (m) => m[1].trim()
          );
          const items = evidenceIds.map((evidence_id) => ({
            evidence_id,
            lesson: {
              statement: `Lesson extracted from ${evidence_id}`,
              kind: 'engineering_lesson',
              tags: ['testing'],
              confidence: 0.6,
              title: `Lesson extracted from ${evidence_id}`
            }
          }));
          return { choices: [{ message: { content: JSON.stringify({ items }) } }] };
        }
      }
    };
  }
}));

// Dynamic imports must come after unstable_mockModule so the mock is in place
let rebuildLearningsDatabase;
let buildEmbeddingInputString;
let buildEvidenceRecordsFromPullRequest;
let extractLearningRecords;
let loadCanonicalRecords;
let queryLearnings;

beforeAll(async () => {
  ({ rebuildLearningsDatabase } = await import('../dist/learnings/builder.js'));
  ({ buildEmbeddingInputString } = await import('../dist/learnings/embeddings.js'));
  ({ buildEvidenceRecordsFromPullRequest } = await import('../dist/learnings/evidence-writer.js'));
  ({ extractLearningRecords } = await import('../dist/learnings/extractor.js'));
  ({ loadCanonicalRecords } = await import('../dist/learnings/parser.js'));
  ({ queryLearnings } = await import('../dist/learnings/query.js'));
});

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

  test('rebuilds .ivan/db.sqlite and returns evidence-backed query results', async () => {
    const repoPath = copyFixtureRepo();
    const result = await rebuildLearningsDatabase(repoPath);
    const queryResults = await queryLearnings(repoPath, 'locks await', { limit: 2 });

    expect(fs.existsSync(result.dbPath)).toBe(true);
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
      fs.existsSync(path.join(repoPath, '.ivan', 'evidence.jsonl'))
    ).toBe(true);
    expect(
      fs.existsSync(path.join(repoPath, '.ivan', 'lessons.jsonl'))
    ).toBe(true);
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

  test('install-hooks writes the two Claude hook integrations idempotently', () => {
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
    ).toBe(false);

    expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
    expect(settings.hooks.PostToolUse).toHaveLength(1);
    expect(settings.hooks.Stop).toBeUndefined();
    expect(settings.hooks.PostToolUse[0].matcher).toBe(
      'Edit|Write|MultiEdit'
    );
    expect(settings.hooks.UserPromptSubmit[0].hooks[0].command).toContain(
      'ivan-learnings-user-prompt.sh'
    );
    expect(settings.hooks.PostToolUse[0].hooks[0].command).toContain(
      'ivan-learnings-post-edit.sh'
    );
  });

  test('buildEmbeddingInputString produces expected concatenation', () => {
    const learning = {
      kind: 'engineering_lesson',
      title: 'Avoid locks',
      statement: 'Do not hold locks across awaits.',
      rationale: 'Causes deadlocks.',
      applicability: 'Async handlers.',
      tags: ['async', 'locking']
    };

    const result = buildEmbeddingInputString(learning);

    expect(result).toBe(
      'engineering_lesson\nAvoid locks\nDo not hold locks across awaits.\nCauses deadlocks.\nAsync handlers.\nasync locking'
    );
  });

  test('rebuild writes embedding cache to JSONL; second rebuild reuses cache entirely', async () => {
    const repoPath = copyFixtureRepo();
    const lessonsPath = path.join(repoPath, '.ivan', 'lessons.jsonl');

    // Strip any pre-cached embeddings from the fixture so we can test cold-cache generation
    const raw = fs.readFileSync(lessonsPath, 'utf8');
    const stripped = raw.trim().split('\n').map((line) => {
      const rec = JSON.parse(line);
      delete rec.embedding;
      delete rec.embeddingInputHash;
      return JSON.stringify(rec);
    }).join('\n') + '\n';
    fs.writeFileSync(lessonsPath, stripped, 'utf8');

    // First rebuild: no cached embeddings, should generate 1
    const first = await rebuildLearningsDatabase(repoPath);

    expect(first.embeddingsGenerated).toBe(1);
    expect(first.embeddingsCached).toBe(0);

    // JSONL should now contain embedding and embeddingInputHash
    const afterFirst = fs.readFileSync(lessonsPath, 'utf8');
    const parsedFirst = JSON.parse(afterFirst.trim().split('\n')[0]);
    expect(Array.isArray(parsedFirst.embedding)).toBe(true);
    expect(parsedFirst.embedding).toHaveLength(1536);
    expect(typeof parsedFirst.embeddingInputHash).toBe('string');
    expect(parsedFirst.embeddingInputHash).toHaveLength(64);

    // Second rebuild: all embeddings cached, 0 generated
    const second = await rebuildLearningsDatabase(repoPath);

    expect(second.embeddingsCached).toBe(1);
    expect(second.embeddingsGenerated).toBe(0);
  });

  test('modifying a learning statement triggers regeneration for only that record', async () => {
    const repoPath = copyFixtureRepo();
    const lessonsPath = path.join(repoPath, '.ivan', 'lessons.jsonl');

    // First rebuild to warm the cache
    await rebuildLearningsDatabase(repoPath);

    // Read back the cached hash
    const afterFirst = fs.readFileSync(lessonsPath, 'utf8');
    const recordFirst = JSON.parse(afterFirst.trim().split('\n')[0]);
    const originalHash = recordFirst.embeddingInputHash;

    // Modify the statement in the JSONL directly
    const modified = afterFirst.replace(
      '"statement":"Avoid holding locks across awaits or other blocking operations."',
      '"statement":"Never hold locks across awaits."'
    );
    fs.writeFileSync(lessonsPath, modified, 'utf8');

    // Second rebuild: hash mismatch → regenerate
    const second = await rebuildLearningsDatabase(repoPath);

    expect(second.embeddingsGenerated).toBe(1);
    expect(second.embeddingsCached).toBe(0);

    // New hash should differ from original
    const afterSecond = fs.readFileSync(lessonsPath, 'utf8');
    const recordSecond = JSON.parse(afterSecond.trim().split('\n')[0]);
    expect(recordSecond.embeddingInputHash).not.toBe(originalHash);
  });

  test('maps GitHub PR evidence into deterministic canonical evidence records', () => {
    const records = buildEvidenceRecordsFromPullRequest({
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

  test('extractor suppresses bot evidence and passes human evidence to the LLM', async () => {
    const extracted = await extractLearningRecords([
      {
        type: 'evidence',
        sourcePath: '.ivan/evidence.jsonl',
        id: 'ev_pr_summary',
        source_system: 'github',
        source_type: 'pull_request',
        external_id: 'github:ariso-ai/ivan:pr:42',
        title: 'Feature/prompt rewriting',
        content: [
          'PR #42: Feature/prompt rewriting',
          '',
          'Adds an optional --rewrite-prompt step that cleans up noisy tickets before sending them to Claude Code.',
          '',
          'Verify DB after any rewrite run: sqlite3 ~/.ivan/db.sqlite ...'
        ].join('\n'),
        author_type: 'human',
        author_name: 'michaelgeiger',
        boosts: ['pr_summary'],
        penalties: [],
        occurred_at: '2026-03-11T00:00:00Z',
        created_at: '2026-03-11T00:00:00Z',
        updated_at: '2026-03-11T00:00:00Z',
        base_weight: 5,
        final_weight: 5
      },
      {
        type: 'evidence',
        sourcePath: '.ivan/evidence.jsonl',
        id: 'ev_bot_review',
        source_system: 'github',
        source_type: 'pr_review_thread',
        external_id: 'github:ariso-ai/ivan:pr:42:thread:1',
        author_type: 'bot',
        author_name: 'coderabbitai',
        title: 'Review thread on src/index.ts:10',
        content: '**Minor: Question length filter may be too aggressive.**',
        boosts: [],
        penalties: [],
        occurred_at: '2026-03-11T00:01:00Z',
        created_at: '2026-03-11T00:01:00Z',
        updated_at: '2026-03-11T00:01:00Z',
        base_weight: 3,
        final_weight: 3
      }
    ]);

    // Bot evidence is pre-filtered before the LLM; only the human PR summary survives.
    expect(extracted).toHaveLength(1);
    expect(extracted[0].evidence_ids).toEqual(['ev_pr_summary']);
    expect(extracted[0].statement).toBeTruthy();
    expect(extracted[0].kind).toMatch(/^(repo_convention|engineering_lesson)$/);
    expect(Array.isArray(extracted[0].tags)).toBe(true);
  });

  test('extractor sends human review comments to the LLM and returns a structured lesson', async () => {
    const extracted = await extractLearningRecords([
      {
        type: 'evidence',
        sourcePath: '.ivan/evidence.jsonl',
        id: 'ev_human_review',
        source_system: 'github',
        source_type: 'pr_review_thread',
        external_id: 'github:ariso-ai/ivan:pr:42:thread:2',
        author_type: 'human',
        author_name: 'reviewer1',
        title: 'Review thread on src/prompts.ts:12',
        content:
          'I think a centralized service for prompt templates would be nice as we add more prompts.',
        boosts: [],
        penalties: [],
        occurred_at: '2026-03-11T00:02:00Z',
        created_at: '2026-03-11T00:02:00Z',
        updated_at: '2026-03-11T00:02:00Z',
        base_weight: 3,
        final_weight: 3
      }
    ]);

    expect(extracted).toHaveLength(1);
    expect(extracted[0].evidence_ids).toEqual(['ev_human_review']);
    expect(typeof extracted[0].statement).toBe('string');
    expect(extracted[0].statement.length).toBeGreaterThan(0);
    expect(extracted[0].kind).toMatch(/^(repo_convention|engineering_lesson)$/);
    expect(Array.isArray(extracted[0].tags)).toBe(true);
    expect(extracted[0].tags.length).toBeGreaterThan(0);
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
    encoding: 'utf8',
    env: { ...process.env, OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? 'sk-test' }
  });
}
