import { Effect } from 'effect';
import type { CanonicalDataset } from './models.js';
import { CanonicalStore } from './canonical-store.js';
import { runLearningsEffect } from './run-effect.js';

export function loadCanonicalRecords(
  repoPath: string
): Promise<CanonicalDataset> {
  return runLearningsEffect(
    Effect.gen(function* () {
      const store = yield* CanonicalStore;
      return yield* store.load(repoPath);
    })
  );
}
