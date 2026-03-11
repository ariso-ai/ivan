import * as NodeContext from '@effect/platform-node/NodeContext';
import { Cause, Effect, Layer } from 'effect';
import { CanonicalStoreLive } from './canonical-store.js';
import { GitMetadataLive } from './git-metadata.js';
import { LearningsRepositoryLive } from './repository.js';

const nodeLayer = NodeContext.layer;
const gitLayer = GitMetadataLive.pipe(Layer.provide(nodeLayer));
const canonicalLayer = CanonicalStoreLive.pipe(
  Layer.provideMerge(nodeLayer),
  Layer.provideMerge(gitLayer)
);

export const LearningsLive = Layer.mergeAll(
  nodeLayer,
  gitLayer,
  canonicalLayer,
  LearningsRepositoryLive
);

export async function runLearningsEffect<A, E, R>(
  effect: Effect.Effect<A, E, R>
): Promise<A> {
  try {
    return await Effect.runPromise(
      effect.pipe(Effect.provide(LearningsLive)) as Effect.Effect<A, E, never>
    );
  } catch (error) {
    if (Cause.isCause(error)) {
      throw new Error(Cause.pretty(error));
    }
    throw error;
  }
}
