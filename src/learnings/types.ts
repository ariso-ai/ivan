import type { LearningEvidenceView, LearningView } from './models.js';

export interface LearningsSearchOptions {
  limit?: number;
}

export type LearningsQueryEvidence = LearningEvidenceView;
export type LearningsQueryResult = LearningView;
