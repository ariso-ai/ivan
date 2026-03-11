import chalk from 'chalk';
import { ingestPullRequestEvidence } from './github-ingestion.js';

interface IngestPrCommandOptions {
  repo: string;
  pr: string;
}

export async function runIngestPrCommand(
  options: IngestPrCommandOptions
): Promise<void> {
  const prNumber = parseInt(options.pr, 10);
  if (Number.isNaN(prNumber) || prNumber <= 0) {
    throw new Error('PR number must be a positive integer');
  }

  const result = await ingestPullRequestEvidence(options.repo, prNumber);

  console.log(chalk.green('✅ GitHub PR evidence ingested'));
  console.log(chalk.gray(`Repository ID: ${result.repositoryId}`));
  console.log(chalk.gray(`Evidence records written: ${result.writtenEvidenceCount}`));
  console.log(chalk.gray(`Rebuilt DB: ${result.rebuild.dbPath}`));
}
