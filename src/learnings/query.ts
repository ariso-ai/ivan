import { Effect } from 'effect';
import type { LearningView } from './models.js';
import type { QueryRequest } from './models.js';
import { LearningsRepository } from './repository.js';
import { runLearningsEffect } from './run-effect.js';

export interface LearningsSearchOptions {
  readonly limit?: number;
}

export type LearningsQueryEvidence = LearningView['evidence'][number];
export type LearningsQueryResult = LearningView;

const query = Effect.fn('Learnings.query')(function* (request: QueryRequest) {
  const repo = yield* LearningsRepository;
  return yield* repo.query(request);
});

export const queryLearnings = (
  repoPath: string,
  text: string,
  options: LearningsSearchOptions = {}
): Promise<ReadonlyArray<LearningsQueryResult>> =>
  runLearningsEffect(
    query({
      repoPath,
      text,
      ...(options.limit === undefined ? {} : { limit: options.limit })
    })
  );
