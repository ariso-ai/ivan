import { Effect } from 'effect';
import { CanonicalStore } from './canonical-store.js';
import type { LearningRecord } from './models.js';
import { runLearningsEffect } from './run-effect.js';

export function writeLearningRecords(
  repoPath: string,
  repositoryId: string,
  records: LearningRecord[]
): Promise<string[]> {
  return runLearningsEffect(
    Effect.gen(function* () {
      const store = yield* CanonicalStore;
      const written = yield* store.writeLearnings(
        repoPath,
        repositoryId,
        records
      );
      return [...written];
    })
  );
}
