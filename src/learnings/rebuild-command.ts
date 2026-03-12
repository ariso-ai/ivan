// CLI handler for `ivan learnings rebuild`.
// Drops and recreates learnings.db from the canonical JSONL files without touching GitHub.

import chalk from 'chalk';
import { isLearningsDatabaseStale, rebuildLearningsDatabase } from './builder.js';

interface RebuildCommandOptions {
  repo: string;
  ifStale?: boolean;
}

/** Commander action handler: calls `rebuildLearningsDatabase` and prints record counts. */
export async function runRebuildCommand(
  options: RebuildCommandOptions
): Promise<void> {
  if (options.ifStale && !isLearningsDatabaseStale(options.repo)) {
    console.log(chalk.gray('learnings.db is up to date'));
    return;
  }

  const result = rebuildLearningsDatabase(options.repo);

  console.log(chalk.green('✅ Learnings database rebuilt'));
  console.log(chalk.gray(`DB: ${result.dbPath}`));
  console.log(
    chalk.gray(
      `Repositories: ${result.repositoryCount}, evidence: ${result.evidenceCount}, learnings: ${result.learningCount}`
    )
  );
}
