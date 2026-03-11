import chalk from 'chalk';
import { rebuildLearningsDatabase } from './builder.js';

interface RebuildCommandOptions {
  repo: string;
}

export async function runRebuildCommand(
  options: RebuildCommandOptions
): Promise<void> {
  const result = rebuildLearningsDatabase(options.repo);

  console.log(chalk.green('✅ Learnings database rebuilt'));
  console.log(chalk.gray(`DB: ${result.dbPath}`));
  console.log(
    chalk.gray(
      `Repositories: ${result.repositoryCount}, evidence: ${result.evidenceCount}, learnings: ${result.learningCount}`
    )
  );
}
