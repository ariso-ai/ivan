import type { RebuildResult } from './models.js';
import { rebuild } from './rebuild-program.js';
import { runLearningsEffect } from './run-effect.js';

export type LearningsBuildResult = RebuildResult;

export const rebuildLearningsDatabase = (
  repoPath: string
): Promise<LearningsBuildResult> => runLearningsEffect(rebuild({ repoPath }));
