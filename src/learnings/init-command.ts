import chalk from 'chalk';
import type { InitResult } from './models.js';
import { init } from './init-program.js';
import { runLearningsEffect } from './run-effect.js';

interface InitCommandOptions {
  repo: string;
}

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
