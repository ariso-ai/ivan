// Entry point for the `learnings` command group.
// Registers all subcommands on the Commander program and re-exports the public API
// used by other parts of ivan (task executor, hooks, etc.).

import { Command } from 'commander';
import { runExtractCommand } from './extract-command.js';
import { initLearningsStore, runInitCommand } from './init-command.js';
import { runIngestPrCommand } from './ingest-pr-command.js';
import { runIngestRepoCommand } from './ingest-repo-command.js';
import {
  installLearningsHooks,
  runInstallHooksCommand
} from './install-hooks-command.js';
import { queryLearnings } from './query.js';
import { runQueryCommand } from './query-command.js';
import { rebuildLearningsDatabase } from './builder.js';
import { runRebuildCommand } from './rebuild-command.js';

/** Registers the `learnings` subcommand tree (init, rebuild, extract, query, ingest-pr, install-hooks) on `program`. */
export function registerLearningsCommands(program: Command): void {
  const learnings = program
    .command('learnings')
    .description(
      'Manage repo-local learnings records and derived .ivan/db.sqlite'
    );

  learnings
    .command('init')
    .description(
      'Initialize canonical learnings storage in the target repository'
    )
    .requiredOption('--repo <path>', 'Repository root path')
    .action(runInitCommand);

  learnings
    .command('rebuild')
    .description(
      'Rebuild <repo>/.ivan/db.sqlite from canonical learnings records'
    )
    .requiredOption('--repo <path>', 'Repository root path')
    .option(
      '--if-stale',
      'Skip rebuild if .ivan/db.sqlite is already up to date'
    )
    .action(runRebuildCommand);

  learnings
    .command('extract')
    .description('Extract canonical learning records from weighted evidence')
    .requiredOption('--repo <path>', 'Repository root path')
    .action(runExtractCommand);

  learnings
    .command('query')
    .description('Query the local .ivan/db.sqlite without live GitHub access')
    .requiredOption('--repo <path>', 'Repository root path')
    .requiredOption('--text <text>', 'Search text')
    .option('--limit <number>', 'Maximum learnings to return', '5')
    .action(runQueryCommand);

  learnings
    .command('ingest-pr')
    .description(
      'Fetch GitHub PR evidence and write canonical evidence records'
    )
    .requiredOption('--repo <path>', 'Repository root path')
    .requiredOption('--pr <number>', 'Pull request number')
    .action(runIngestPrCommand);

  learnings
    .command('ingest-repo')
    .description('Fetch evidence for all PRs in a repo and extract learnings in one pass')
    .requiredOption('--repo <path>', 'Repository root path')
    .option('--limit <number>', 'Maximum number of PRs to ingest', '100')
    .option('--state <state>', 'PR state to fetch: open, closed, merged, or all', 'merged')
    .action(runIngestRepoCommand);

  learnings
    .command('install-hooks')
    .description(
      'Install Claude Code hook scripts for UserPromptSubmit and PostToolUse(Edit|Write|MultiEdit)'
    )
    .requiredOption('--repo <path>', 'Repository root path')
    .action(runInstallHooksCommand);
}

export {
  initLearningsStore,
  installLearningsHooks,
  queryLearnings,
  rebuildLearningsDatabase
};
