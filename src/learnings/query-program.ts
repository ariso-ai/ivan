import { Effect } from 'effect';
import type { QueryRequest } from './models.js';
import { LearningsRepository } from './repository.js';

export const query = Effect.fn('Learnings.query')(function* (
  request: QueryRequest
) {
  const repo = yield* LearningsRepository;
  return yield* repo.query(request);
});
