import { Command } from 'commander';
import { initLearningsStore, runInitCommand } from './init-command.js';
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
}

export { initLearningsStore, queryLearnings, rebuildLearningsDatabase };
