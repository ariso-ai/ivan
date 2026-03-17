// CLI handler for `ivan learnings init`.
// Sets up the repo-local `.ivan/` structure. The derived SQLite file is tracked in git.

import chalk from 'chalk';
import {
  ensureCanonicalJsonlFiles,
  ensureGitignoreCoverage,
  ensureLearningsDirectories,
  resolveLearningsRepositoryContext
} from './repository.js';

interface InitCommandOptions {
  repo: string;
}

/**
 * Initialises the learnings store for `repoPath`: creates the `.ivan/` directory and canonical files.
 */
export function initLearningsStore(repoPath: string): {
  repositoryId: string;
  createdDirectories: string[];
  createdFiles: string[];
  gitignoreUpdated: boolean;
} {
  const context = resolveLearningsRepositoryContext(repoPath);
  const createdDirectories = ensureLearningsDirectories(context);
  const createdFiles = ensureCanonicalJsonlFiles(context.repoPath);
  const gitignoreUpdated = ensureGitignoreCoverage(context.repoPath);

  return {
    repositoryId: context.repositoryId,
    createdDirectories,
    createdFiles,
    gitignoreUpdated
  };
}

/** Commander action handler: calls `initLearningsStore` and prints a formatted summary. */
export async function runInitCommand(
  options: InitCommandOptions
): Promise<void> {
  const result = initLearningsStore(options.repo);

  console.log(chalk.green('✅ Learnings store initialized'));
  console.log(chalk.gray(`Repository ID: ${result.repositoryId}`));

  if (result.createdDirectories.length > 0) {
    console.log(chalk.gray('Created directories:'));
    for (const directory of result.createdDirectories) {
      console.log(chalk.gray(`  - ${directory}`));
    }
  }

  if (result.createdFiles.length > 0) {
    console.log(chalk.gray('Created files:'));
    for (const filePath of result.createdFiles) {
      console.log(chalk.gray(`  - ${filePath}`));
    }
  }

}
