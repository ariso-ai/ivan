import { Effect } from 'effect';
import chalk from 'chalk';
import { CanonicalStore } from './canonical-store.js';
import type { InitResult, RepoPathRequest } from './models.js';
import { runLearningsEffect } from './run-effect.js';

interface InitCommandOptions {
  repo: string;
}

const init = Effect.fn('Learnings.init')(function* (request: RepoPathRequest) {
  const store = yield* CanonicalStore;
  return yield* store.init(request.repoPath);
});

export function initLearningsStore(repoPath: string): Promise<InitResult> {
  return runLearningsEffect(init({ repoPath }));
}

export async function runInitCommand(
  options: InitCommandOptions
): Promise<void> {
  const result = await initLearningsStore(options.repo);

  console.log(chalk.green('✅ Learnings store initialized'));
  console.log(chalk.gray(`Repository ID: ${result.repositoryId}`));
  console.log(chalk.gray(`Repository record: ${result.repositoryFile}`));

  if (result.createdDirectories.length > 0) {
    console.log(chalk.gray('Created directories:'));
    for (const directory of result.createdDirectories) {
      console.log(chalk.gray(`  - ${directory}`));
    }
  }

  console.log(
    chalk.gray(
      result.gitignoreUpdated
        ? 'Updated .gitignore with learnings.db exclusions'
        : '.gitignore already covered learnings.db'
    )
  );
}
