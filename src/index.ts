#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { ConfigManager } from './config.js';
import { TaskExecutor } from './services/task-executor.js';
import { DatabaseManager } from './database.js';

const program = new Command();
const configManager = new ConfigManager();

program
  .name('ivan')
  .description('Ivan - A coding orchestration agent CLI')
  .version('1.0.0');

program
  .command('reconfigure')
  .description('Reconfigure Ivan settings')
  .action(async () => {
    await configManager.reconfigure();
  });

async function checkConfiguration(): Promise<boolean> {
  if (!configManager.isConfigured()) {
    console.log(chalk.yellow('⚠️  Ivan is not configured yet.'));
    console.log('');
    await configManager.setup();
    return true;
  }

  const config = configManager.getConfig();
  if (!config) {
    console.log(chalk.red('❌ Configuration file is corrupted.'));
    console.log(chalk.yellow('Running setup again...'));
    console.log('');
    await configManager.setup();
    return true;
  }

  return false;
}

async function runMigrations(): Promise<void> {
  const dbManager = new DatabaseManager();
  try {
    await dbManager.runMigrations();
  } finally {
    dbManager.close();
  }
}

async function main() {
  try {
    const args = process.argv.slice(2);
    
    if (args.length === 0 || (args.length === 1 && !['reconfigure', '--help', '-h', '--version', '-V'].includes(args[0]))) {
      const wasConfigured = await checkConfiguration();
      if (wasConfigured) {
        console.log('');
        console.log(chalk.cyan('Run "ivan" again to start working on tasks.'));
        return;
      }

      await runMigrations();

      const taskExecutor = new TaskExecutor();
      await taskExecutor.executeWorkflow();
      return;
    }

    await program.parseAsync();
  } catch (error) {
    console.error(chalk.red('Error:'), error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(chalk.red('Unexpected error:'), error);
  process.exit(1);
});