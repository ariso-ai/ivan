import chalk from 'chalk';
import {
  ensureGitignoreCoverage,
  ensureLearningsDirectories,
  resolveLearningsRepositoryContext,
  writeRepositoryRecord
} from './repository.js';

interface InitCommandOptions {
  repo: string;
}

export function initLearningsStore(repoPath: string): {
  repositoryId: string;
  repositoryFile: string;
  createdDirectories: string[];
  gitignoreUpdated: boolean;
  createdRepositoryRecord: boolean;
} {
  const context = resolveLearningsRepositoryContext(repoPath);
  const createdDirectories = ensureLearningsDirectories(context);
  const repositoryWrite = writeRepositoryRecord(context);
  const gitignoreUpdated = ensureGitignoreCoverage(context.repoPath);

  return {
    repositoryId: context.repositoryId,
    repositoryFile: repositoryWrite.filePath,
    createdDirectories,
    gitignoreUpdated,
    createdRepositoryRecord: repositoryWrite.created
  };
}

export async function runInitCommand(
  options: InitCommandOptions
): Promise<void> {
  const result = initLearningsStore(options.repo);

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
