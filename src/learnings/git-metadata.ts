import { Command } from '@effect/platform';
import * as CommandExecutor from '@effect/platform/CommandExecutor';
import { Context, Effect, Layer } from 'effect';
import type { LearningsError } from './errors.js';

export class GitMetadata extends Context.Tag('learnings/GitMetadata')<
  GitMetadata,
  {
    readonly remoteOriginUrl: (
      repoPath: string
    ) => Effect.Effect<string | undefined, LearningsError>;
  }
>() {}

export const GitMetadataLive = Layer.effect(
  GitMetadata,
  Effect.gen(function* () {
    const commandExecutor = yield* CommandExecutor.CommandExecutor;

    return GitMetadata.of({
      remoteOriginUrl: Effect.fn('GitMetadata.remoteOriginUrl')(function* (
        repoPath: string
      ) {
        const command = Command.make(
          'git',
          'config',
          '--get',
          'remote.origin.url'
        ).pipe(Command.workingDirectory(repoPath));

        const output = yield* Command.string(command).pipe(
          Effect.provideService(
            CommandExecutor.CommandExecutor,
            commandExecutor
          ),
          Effect.catchAll(() => Effect.succeed(''))
        );

        const value = output.trim();
        return value.length > 0 ? value : undefined;
      })
    });
  })
);
