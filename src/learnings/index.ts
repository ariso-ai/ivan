// Entry point for the `learn` command group.
// Registers all subcommands on the Commander program and re-exports the public API
// used by other parts of ivan (task executor, hooks, etc.).

import { Command } from 'commander';
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
import { runCodingSessionsCommand } from './coding-sessions-command.js';

/** Registers the `learn` subcommand tree on `program`. */
export function registerLearningsCommands(program: Command): void {
  const learn = program
    .command('learn')
    .description('Learn from PRs, coding sessions, and repo history');

  learn
    .command('init')
    .description(
      'Initialize canonical learnings storage in the target repository'
    )
    .requiredOption('--repo <path>', 'Repository root path')
    .action(runInitCommand);

  learn
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

  learn
    .command('query')
    .description('Query the local .ivan/db.sqlite without live GitHub access')
    .requiredOption('--repo <path>', 'Repository root path')
    .requiredOption('--text <text>', 'Search text')
    .option('--limit <number>', 'Maximum learnings to return', '5')
    .action(runQueryCommand);

  learn
    .command('ingest-pr')
    .description(
      'Fetch GitHub PR evidence and write canonical evidence records'
    )
    .requiredOption('--repo <path>', 'Repository root path')
    .requiredOption('--pr <number>', 'Pull request number')
    .action(runIngestPrCommand);

  learn
    .command('ingest-repo')
    .description(
      'Fetch evidence for all PRs in a repo and extract learnings in one pass'
    )
    .requiredOption('--repo <path>', 'Repository root path')
    .option('--limit <number>', 'Maximum number of PRs to ingest', '100')
    .option(
      '--state <state>',
      'PR state to fetch: open, closed, merged, or all',
      'merged'
    )
    .action(runIngestRepoCommand);

  learn
    .command('install-hooks')
    .description(
      'Install Claude Code hook scripts for UserPromptSubmit and PostToolUse(Edit|Write|MultiEdit)'
    )
    .requiredOption('--repo <path>', 'Repository root path')
    .action(runInstallHooksCommand);

  learn
    .command('coding-sessions')
    .description(
      'Analyze local Claude Code sessions to extract thinking patterns and example interactions'
    )
    .requiredOption('--repo <path>', 'Repository root path')
    .option('--project <name>', 'Only analyze sessions from a specific project')
    .option('--recent <days>', 'Only analyze sessions from the last N days')
    .option('--dry-run', 'Show what would be analyzed without making API calls')
    .option('--force', 'Re-analyze all sessions, ignoring cache')
    .option(
      '--reset',
      'Clear session analysis cache and session-derived learnings'
    )
    .action(runCodingSessionsCommand);
}

export {
  initLearningsStore,
  installLearningsHooks,
  queryLearnings,
  rebuildLearningsDatabase
};
