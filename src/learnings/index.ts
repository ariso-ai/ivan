import { Command } from 'commander';
import { initLearningsStore, runInitCommand } from './init-command.js';
import { runIngestPrCommand } from './ingest-pr-command.js';
import { installLearningsHooks, runInstallHooksCommand } from './install-hooks-command.js';
import { queryLearnings } from './query.js';
import { runQueryCommand } from './query-command.js';
import { rebuildLearningsDatabase } from './builder.js';
import { runRebuildCommand } from './rebuild-command.js';

export function registerLearningsCommands(program: Command): void {
  const learnings = program
    .command('learnings')
    .description(
      'Manage repo-local learnings records and derived learnings.db'
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
    .description('Rebuild <repo>/learnings.db from canonical learnings records')
    .requiredOption('--repo <path>', 'Repository root path')
    .action(runRebuildCommand);

  learnings
    .command('query')
    .description('Query the local learnings.db without live GitHub access')
    .requiredOption('--repo <path>', 'Repository root path')
    .requiredOption('--text <text>', 'Search text')
    .option('--limit <number>', 'Maximum learnings to return', '5')
    .action(runQueryCommand);

  learnings
    .command('ingest-pr')
    .description('Fetch GitHub PR evidence and write canonical evidence records')
    .requiredOption('--repo <path>', 'Repository root path')
    .requiredOption('--pr <number>', 'Pull request number')
    .action(runIngestPrCommand);

  learnings
    .command('install-hooks')
    .description(
      'Install Claude Code hook scripts for UserPromptSubmit, PostToolUse(Edit|Write|MultiEdit), and Stop'
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
