#!/usr/bin/env node

import { ConfigManager } from './config/config.js';
import { OrchestrationAgent } from './agent.js';
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';

async function runInteractiveMode() {
  const configManager = new ConfigManager();
  const config = await configManager.initialize();

  console.log(chalk.blue(`\n📂 Working with repository: ${config.repository}\n`));

  const agent = new OrchestrationAgent(config, configManager.getDatabase());

  while (true) {
    const { task } = await inquirer.prompt([
      {
        type: 'input',
        name: 'task',
        message: chalk.cyan('What would you like to work on? (type "exit" to quit):'),
        validate: (input: string) => {
          if (!input || input.trim() === '') {
            return 'Please enter a task or type "exit" to quit';
          }
          return true;
        }
      }
    ]);

    if (task.toLowerCase() === 'exit') {
      console.log(chalk.yellow('\n👋 Goodbye! Thanks for using Ivan.\n'));
      process.exit(0);
    }

    const spinner = ora({
      text: 'Processing your request...',
      color: 'cyan'
    }).start();

    try {
      await agent.executeTask(task);
      spinner.succeed('Task completed successfully!');
    } catch (error) {
      spinner.fail('Task failed');
      console.error(chalk.red('Error:'), error);
    }

    console.log(chalk.gray('\n' + '─'.repeat(50) + '\n'));
  }
}

async function main() {
  try {
    const program = new Command();
    
    program
      .name('ivan')
      .description('Ivan - Your Coding Orchestration Agent')
      .version('1.0.0');

    program
      .command('configure')
      .description('Configure or reconfigure Ivan')
      .action(async () => {
        try {
          const configManager = new ConfigManager();
          await configManager.forceReconfigure();
        } catch (error) {
          console.error(chalk.red('Configuration error:'), error);
          process.exit(1);
        }
      });

    if (process.argv.length > 2) {
      await program.parseAsync();
    } else {
      await runInteractiveMode();
    }
  } catch (error) {
    console.error(chalk.red('Fatal error:'), error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(chalk.red('Unhandled error:'), error);
  process.exit(1);
});

