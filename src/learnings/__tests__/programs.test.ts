import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { after, describe, it } from 'node:test';
import { initLearningsStore } from '../init-command.js';
import { queryLearnings } from '../query.js';
import { rebuildLearningsDatabase } from '../builder.js';

const tempPaths: string[] = [];

after(async () => {
  await Promise.all(
    tempPaths.map((path) => rm(path, { recursive: true, force: true }))
  );
});

describe('learnings effect programs', () => {
  it('initializes, rebuilds, and queries a learnings repo', async () => {
    const repoPath = await mkdtemp(join(tmpdir(), 'ivan-learnings-'));
    tempPaths.push(repoPath);

    await writeFile(join(repoPath, '.gitignore'), '', 'utf8');

    const initResult = await initLearningsStore(repoPath);
    assert.match(initResult.repositoryId, /^repo_ivan-learnings-/);

    const repositoriesPath = join(repoPath, 'learnings', 'repositories.jsonl');
    const repositoryRecord = JSON.parse(
      (await readFile(repositoriesPath, 'utf8')).trim()
    ) as { readonly id: string };
    const repositoryId = repositoryRecord.id;
    assert.equal(initResult.repositoryId, repositoryId);

    await writeFile(
      join(repoPath, 'learnings', 'evidence', `${repositoryId}.jsonl`),
      `${JSON.stringify({
        id: 'ev_effect_architecture',
        repository_id: repositoryId,
        source_system: 'github',
        source_type: 'pr_review',
        content: 'Prefer Effect services and keep runtime at the CLI edge.',
        boosts: ['architecture'],
        penalties: [],
        created_at: '2026-03-11T00:00:00.000Z',
        updated_at: '2026-03-11T00:00:00.000Z'
      })}\n`,
      'utf8'
    );

    await writeFile(
      join(repoPath, 'learnings', 'lessons', `${repositoryId}.jsonl`),
      `${JSON.stringify({
        id: 'lrn_effect_architecture',
        repository_id: repositoryId,
        kind: 'engineering_lesson',
        statement: 'Prefer Effect services and keep runtime at the CLI edge',
        status: 'active',
        evidence_ids: ['ev_effect_architecture'],
        tags: ['effect', 'architecture'],
        created_at: '2026-03-11T00:00:00.000Z',
        updated_at: '2026-03-11T00:00:00.000Z'
      })}\n`,
      'utf8'
    );

    const rebuildResult = await rebuildLearningsDatabase(repoPath);
    assert.equal(rebuildResult.repositoryCount, 1);
    assert.equal(rebuildResult.evidenceCount, 1);
    assert.equal(rebuildResult.learningCount, 1);

    const results = await queryLearnings(repoPath, 'runtime edge', {
      limit: 3
    });
    assert.equal(results.length, 1);
    assert.equal(results[0]?.id, 'lrn_effect_architecture');
    assert.deepEqual(results[0]?.tags, ['architecture', 'effect']);
    assert.equal(results[0]?.evidence[0]?.id, 'ev_effect_architecture');
  });
});
