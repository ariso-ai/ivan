// CLI handler for `ivan learnings ingest-repo`.
// Fetches all PRs for a repo, builds signals in memory, then runs a single extract + rebuild pass.

import chalk from 'chalk';
import { extractLearningsFromEvidence } from './extractor.js';
import { fetchAllPullRequestNumbers } from './github-evidence.js';
import { fetchPullRequestSignals } from './github-ingestion.js';
import type { EvidenceSignal, EvidenceContextCache } from './record-types.js';
import {
  ensureLearningsDirectories,
  resolveLearningsRepositoryContext
} from './repository.js';

interface IngestRepoCommandOptions {
  repo: string;
  limit?: string;
  state?: string;
}

/** Commander action handler: lists all PRs, fetches signals for each, then runs a single extract + rebuild. */
export async function runIngestRepoCommand(
  options: IngestRepoCommandOptions
): Promise<void> {
  const limit = options.limit ? parseInt(options.limit, 10) : 100;
  if (Number.isNaN(limit) || limit <= 0) {
    throw new Error('Limit must be a positive integer');
  }

  const rawState = options.state ?? 'merged';
  if (rawState !== 'open' && rawState !== 'closed' && rawState !== 'merged' && rawState !== 'all') {
    throw new Error('State must be one of: open, closed, merged, all');
  }
  const state = rawState as 'open' | 'closed' | 'merged' | 'all';

  const context = resolveLearningsRepositoryContext(options.repo);
  ensureLearningsDirectories(context);

  console.log(chalk.gray(`Fetching PR list (state=${state}, limit=${limit})...`));
  const prNumbers = await fetchAllPullRequestNumbers(options.repo, { state, limit });

  if (prNumbers.length === 0) {
    console.log(chalk.yellow('No PRs found.'));
    return;
  }

  console.log(chalk.gray(`Found ${prNumbers.length} PRs. Fetching signals...`));

  const allSignals: EvidenceSignal[] = [];
  const mergedCache: EvidenceContextCache = new Map();
  let failed = 0;

  for (let i = 0; i < prNumbers.length; i++) {
    const prNumber = prNumbers[i];
    process.stdout.write(
      chalk.gray(`  [${i + 1}/${prNumbers.length}] PR #${prNumber}... `)
    );

    try {
      const { signals, contextCache } = await fetchPullRequestSignals(
        options.repo,
        prNumber
      );
      allSignals.push(...signals);
      for (const [id, ctx] of contextCache) {
        mergedCache.set(id, ctx);
      }
      process.stdout.write(chalk.green(`${signals.length} signals\n`));
    } catch (err) {
      failed++;
      process.stdout.write(chalk.red(`failed (${(err as Error).message})\n`));
    }
  }

  if (failed > 0) {
    console.log(chalk.yellow(`${failed} PRs failed and were skipped.`));
  }

  console.log(chalk.gray('Extracting learnings...'));
  const extraction = await extractLearningsFromEvidence(options.repo, allSignals, mergedCache);

  console.log(chalk.green('✅ Repo ingestion complete'));
  console.log(chalk.gray(`Learnings: ${extraction.writtenLearningCount}`));
  console.log(chalk.gray(`DB: ${extraction.rebuild.dbPath}`));
}
