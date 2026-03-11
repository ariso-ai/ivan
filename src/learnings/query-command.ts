import chalk from 'chalk';
import { queryLearnings } from './query.js';

interface QueryCommandOptions {
  repo: string;
  text: string;
  limit?: string;
}

export async function runQueryCommand(
  options: QueryCommandOptions
): Promise<void> {
  const limit = options.limit ? parseInt(options.limit, 10) : 5;
  if (Number.isNaN(limit) || limit <= 0) {
    throw new Error('Query limit must be a positive integer');
  }

  const results = queryLearnings(options.repo, options.text, { limit });

  if (results.length === 0) {
    console.log(chalk.yellow('No learnings matched that query.'));
    return;
  }

  results.forEach((result, index) => {
    console.log(chalk.cyan(`${index + 1}. ${result.statement}`));

    const metadata = [
      `id=${result.id}`,
      `repo=${result.repositoryId}`,
      `kind=${result.kind}`
    ];
    if (result.confidence !== undefined) {
      metadata.push(`confidence=${result.confidence.toFixed(2)}`);
    }
    if (result.tags.length > 0) {
      metadata.push(`tags=${result.tags.join(', ')}`);
    }
    console.log(chalk.gray(`   ${metadata.join(' | ')}`));

    if (result.rationale) {
      console.log(chalk.gray(`   Rationale: ${result.rationale}`));
    }

    if (result.applicability) {
      console.log(chalk.gray(`   Applicability: ${result.applicability}`));
    }

    for (const evidence of result.evidence) {
      const evidenceMeta = [evidence.id, evidence.sourceType];
      if (evidence.finalWeight !== undefined) {
        evidenceMeta.push(`weight=${evidence.finalWeight}`);
      }
      if (evidence.url) {
        evidenceMeta.push(evidence.url);
      }
      console.log(chalk.gray(`   Evidence: ${evidenceMeta.join(' | ')}`));
    }

    if (index < results.length - 1) {
      console.log('');
    }
  });
}
