import type { LearningView } from './models.js';
import { query } from './query-program.js';
import { runLearningsEffect } from './run-effect.js';

export interface LearningsSearchOptions {
  readonly limit?: number;
}

export type LearningsQueryEvidence = LearningView['evidence'][number];
export type LearningsQueryResult = LearningView;

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
