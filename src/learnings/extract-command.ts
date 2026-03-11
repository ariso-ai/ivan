import chalk from 'chalk';
import { extractLearningsFromEvidence } from './extractor.js';

interface ExtractCommandOptions {
  repo: string;
}

export async function runExtractCommand(
  options: ExtractCommandOptions
): Promise<void> {
  const result = await extractLearningsFromEvidence(options.repo);

  console.log(chalk.green('✅ Learnings extracted from evidence'));
  console.log(chalk.gray(`Repository ID: ${result.repositoryId}`));
  console.log(
    chalk.gray(`Learning records written: ${result.writtenLearningCount}`)
  );
  console.log(chalk.gray(`Rebuilt DB: ${result.rebuild.dbPath}`));
}
