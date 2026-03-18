// CLI handler for `ivan learnings query`.
// Searches the local `.ivan/db.sqlite` and prints each result with statement, metadata, and evidence links.

import chalk from 'chalk';
import { queryLearnings } from './query.js';

interface QueryCommandOptions {
  repo: string;
  text: string;
  limit?: string;
}

/** Commander action handler: validates options, calls `queryLearnings`, and pretty-prints results. */
export async function runQueryCommand(
  options: QueryCommandOptions
): Promise<void> {
  const limit = options.limit ? parseInt(options.limit, 10) : 5;
  if (Number.isNaN(limit) || limit <= 0) {
    throw new Error('Query limit must be a positive integer');
  }

  const results = await queryLearnings(options.repo, options.text, { limit });

  if (results.length === 0) {
    console.log(chalk.yellow('No learnings matched that query.'));
    return;
  }

  results.forEach((result, index) => {
    console.log(chalk.cyan(`${index + 1}. ${result.statement}`));

    const metadata = [
      `id=${result.id}`,
      `kind=${result.kind}`
    ];
    if (result.confidence !== undefined) {
      metadata.push(`confidence=${result.confidence.toFixed(2)}`);
    }
    console.log(chalk.gray(`   ${metadata.join(' | ')}`));

    if (result.rationale) {
      console.log(chalk.gray(`   Rationale: ${result.rationale}`));
    }

    if (result.applicability) {
      console.log(chalk.gray(`   Applicability: ${result.applicability}`));
    }

    if (result.source_url) {
      console.log(chalk.gray(`   Source: ${result.source_url}`));
    }

    if (index < results.length - 1) {
      console.log('');
    }
  });
}
