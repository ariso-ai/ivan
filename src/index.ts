#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { ConfigManager } from './config.js';
import { TaskExecutor } from './services/task-executor.js';
import { AddressExecutor } from './services/address-executor.js';
import { DatabaseManager } from './database.js';
import { WebServer } from './web-server.js';
import { NonInteractiveConfig } from './types/non-interactive-config.js';
import { readFileSync } from 'fs';

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

program
  .command('config-tools')
  .description('Configure allowed tools for the current repository')
  .action(async () => {
    const repoPath = process.cwd();
    await configManager.promptForRepoAllowedTools(repoPath);
  });

program
  .command('edit-repo-instructions')
  .description('Set or update repository-specific instructions')
  .action(async () => {
    const repoPath = process.cwd();
    await configManager.promptForRepoInstructions(repoPath);
  });

program
  .command('choose-model')
  .description('Configure which Claude model to use for code tasks')
  .action(async () => {
    await configManager.promptForModel();
  });

program
  .command('configure-executor')
  .description('Configure how to run Claude Code (SDK or CLI)')
  .action(async () => {
    await configManager.promptForExecutorType();
  });

program
  .command('show-config')
  .description('Show configuration for the current repository')
  .action(async () => {
    const repoPath = process.cwd();
    const config = configManager.getConfig();

    if (!config) {
      console.log(chalk.red('❌ No configuration found'));
      console.log(chalk.yellow('Run "ivan reconfigure" to set up Ivan'));
      return;
    }

    console.log(chalk.blue.bold('📋 Repository Configuration'));
    console.log(chalk.gray(`Repository: ${repoPath}`));
    console.log('');

    const allowedTools = await configManager.getRepoAllowedTools(repoPath);
    const instructions = await configManager.getRepoInstructions(repoPath);

    console.log(chalk.cyan('Allowed Tools:'));
    if (allowedTools) {
      console.log('  ' + allowedTools.join(', '));
    } else {
      console.log(chalk.gray('  [*] (all tools allowed - default)'));
    }

    console.log('');
    console.log(chalk.cyan('Repository Instructions:'));
    if (instructions) {
      console.log('  ' + instructions.split('\n').join('\n  '));
    } else {
      console.log(chalk.gray('  (none configured)'));
    }

    console.log('');
    console.log(chalk.cyan('Claude Model:'));
    const model = config.claudeModel || 'claude-3-5-sonnet-latest';
    console.log('  ' + model);

    console.log('');
    console.log(chalk.cyan('Executor Type:'));
    const executorType = config.executorType || 'sdk';
    console.log('  ' + executorType.toUpperCase());
  });

program
  .command('web')
  .description('Start web server to view jobs and tasks in browser')
  .option('-p, --port <port>', 'Port number for web server', '3000')
  .action(async (options) => {
    await runMigrations();
    
    const port = parseInt(options.port);
    const webServer = new WebServer(port);
    
    // Store PID for stop command
    const fs = await import('fs');
    const path = await import('path');
    const os = await import('os');
    
    const pidFile = path.join(os.tmpdir(), `ivan-web-server-${port}.pid`);
    fs.writeFileSync(pidFile, process.pid.toString());
    
    console.log(chalk.blue('🚀 Starting Ivan web server...'));
    console.log('');
    
    await webServer.start();
    console.log(chalk.green('✅ Web server started successfully!'));
    console.log(chalk.cyan(`📱 Open http://localhost:${port} in your browser`));
    console.log(chalk.gray(`📝 Server PID: ${process.pid}`));
    console.log('');
    console.log(chalk.gray('Press Ctrl+C or run "ivan web-stop" to stop the server'));
    
    // Handle graceful shutdown
    const cleanup = async () => {
      console.log('');
      console.log(chalk.yellow('🛑 Shutting down web server...'));
      try {
        fs.unlinkSync(pidFile);
      } catch (e) {
        // Ignore error if file doesn't exist
      }
      await webServer.close();
      process.exit(0);
    };
    
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
  });

program
  .command('address')
  .description('Address open PRs with unaddressed comments or failing checks')
  .argument('[pr-number]', 'Optional PR number to address')
  .option('--from-user <username>', 'Filter PRs by author GitHub username')
  .action(async (prNumber?: string, options?: { fromUser?: string }) => {
    const wasConfigured = await checkConfiguration();
    if (wasConfigured) {
      console.log('');
      console.log(chalk.cyan('Run "ivan address" again to address PR issues.'));
      return;
    }

    await runMigrations();

    const addressExecutor = new AddressExecutor();
    await addressExecutor.executeWorkflow(
      prNumber ? parseInt(prNumber) : undefined,
      options?.fromUser
    );
  });

program
  .command('web-stop')
  .description('Stop the running web server')
  .option('-p, --port <port>', 'Port number of web server to stop', '3000')
  .action(async (options) => {
    const fs = await import('fs');
    const path = await import('path');
    const os = await import('os');

    const port = parseInt(options.port);
    const pidFile = path.join(os.tmpdir(), `ivan-web-server-${port}.pid`);

    try {
      if (!fs.existsSync(pidFile)) {
        console.log(chalk.yellow(`⚠️  No web server found running on port ${port}`));
        return;
      }

      const pidStr = fs.readFileSync(pidFile, 'utf8').trim();
      const pid = parseInt(pidStr);

      console.log(chalk.blue(`🛑 Stopping web server on port ${port} (PID: ${pid})...`));

      // Try to kill the process
      try {
        process.kill(pid, 'SIGTERM');

        // Wait a moment for graceful shutdown
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Check if process still exists
        try {
          process.kill(pid, 0); // Signal 0 just checks if process exists
          console.log(chalk.yellow('Process still running, sending SIGKILL...'));
          process.kill(pid, 'SIGKILL');
        } catch (e) {
          // Process already terminated
        }

        // Clean up PID file
        fs.unlinkSync(pidFile);

        console.log(chalk.green('✅ Web server stopped successfully!'));

      } catch (error: any) {
        if (error.code === 'ESRCH') {
          console.log(chalk.yellow('⚠️  Process no longer exists, cleaning up...'));
          fs.unlinkSync(pidFile);
        } else {
          throw error;
        }
      }

    } catch (error) {
      console.error(chalk.red('❌ Failed to stop web server:'), error);
      process.exit(1);
    }
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

async function runNonInteractive(configPath: string): Promise<void> {
  try {
    // Read and parse config file
    const configContent = readFileSync(configPath, 'utf-8');
    const config: NonInteractiveConfig = JSON.parse(configContent);

    // Validate config
    if (!config.tasks || !Array.isArray(config.tasks) || config.tasks.length === 0) {
      throw new Error('Config must have a "tasks" array with at least one task');
    }

    console.log(chalk.blue.bold('🤖 Running in non-interactive mode'));
    console.log(chalk.gray(`Config: ${configPath}`));
    console.log('');

    // Check configuration
    const wasConfigured = await checkConfiguration();
    if (wasConfigured) {
      throw new Error('Ivan needs to be configured. Please run "ivan reconfigure" first.');
    }

    await runMigrations();

    // Change working directory if specified
    if (config.workingDir) {
      process.chdir(config.workingDir);
      console.log(chalk.blue(`📂 Changed to directory: ${config.workingDir}`));
    }

    const taskExecutor = new TaskExecutor();
    await taskExecutor.executeNonInteractiveWorkflow(config);

    console.log('');
    console.log(chalk.green.bold('✅ Non-interactive execution completed successfully!'));
  } catch (error) {
    console.error(chalk.red.bold('❌ Non-interactive execution failed:'), error);
    throw error;
  }
}

async function main() {
  try {
    const args = process.argv.slice(2);

    // Check for -c/--config flag
    const configFlagIndex = args.findIndex(arg => arg === '-c' || arg === '--config');
    if (configFlagIndex !== -1 && args[configFlagIndex + 1]) {
      const configPath = args[configFlagIndex + 1];
      await runNonInteractive(configPath);
      return;
    }

    if (args.length === 0 || (args.length === 1 && !['reconfigure', 'config-tools', 'edit-repo-instructions', 'show-config', 'choose-model', 'configure-executor', 'web', 'web-stop', 'address', '--help', '-h', '--version', '-V'].includes(args[0]))) {
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