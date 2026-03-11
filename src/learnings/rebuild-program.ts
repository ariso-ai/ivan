import { FileSystem, Path } from '@effect/platform';
import { Effect } from 'effect';
import { CanonicalStore } from './canonical-store.js';
import type { RebuildRequest } from './models.js';
import { LearningsRepository } from './repository.js';

export const rebuild = Effect.fn('Learnings.rebuild')(function* (
  request: RebuildRequest
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const store = yield* CanonicalStore;
  const repo = yield* LearningsRepository;

  const repoPath = path.resolve(request.repoPath);
  const dbPath = path.join(repoPath, 'learnings.db');
  const tempDbPath = path.join(repoPath, '.learnings.db.next');

  const dataset = yield* store.load(repoPath);
  const result = yield* repo.rebuildFromCanonical(tempDbPath, dataset);

  yield* Effect.ignore(fs.remove(dbPath, { force: true }));
  yield* Effect.ignore(fs.remove(`${dbPath}-wal`, { force: true }));
  yield* Effect.ignore(fs.remove(`${dbPath}-shm`, { force: true }));
  yield* fs.rename(tempDbPath, dbPath);

  return {
    ...result,
    dbPath
  };
});
