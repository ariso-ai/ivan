// CLI handler for `ivan learnings rebuild`.
// Drops and recreates `.ivan/db.sqlite` from the canonical JSONL files without touching GitHub.

import chalk from 'chalk';
import {
  isLearningsDatabaseStale,
  rebuildLearningsDatabase
} from './builder.js';

interface RebuildCommandOptions {
  repo: string;
  ifStale?: boolean;
}

/** Commander action handler: calls `rebuildLearningsDatabase` and prints record counts. */
export async function runRebuildCommand(
  options: RebuildCommandOptions
): Promise<void> {
  if (options.ifStale && !(await isLearningsDatabaseStale(options.repo))) {
    console.log(chalk.gray('.ivan/db.sqlite is up to date'));
    return;
  }

  const result = await rebuildLearningsDatabase(options.repo);

  console.log(chalk.green('✅ Learnings database rebuilt'));
  console.log(chalk.gray(`DB: ${result.dbPath}`));
  console.log(chalk.gray(`Evidence: ${result.evidenceCount}, learnings: ${result.learningCount}`));
}
