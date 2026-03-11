import { Effect } from 'effect';
import { CanonicalStore } from './canonical-store.js';
import type { InitRequest } from './models.js';

export const init = Effect.fn('Learnings.init')(function* (
  request: InitRequest
) {
  const store = yield* CanonicalStore;
  return yield* store.init(request.repoPath);
});
