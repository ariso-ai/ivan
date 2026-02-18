#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { ConfigManager } from './config.js';
import { TaskExecutor } from './services/task-executor.js';
import { AddressExecutor } from './services/address-executor.js';
import { DatabaseManager } from './database.js';
import { WebServer } from './web-server.js';
import { NonInteractiveConfig } from './types/non-interactive-config.js';
import { readFileSync, existsSync, mkdirSync, copyFileSync } from 'fs';
import { execSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

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
  .command('config-blocked-tools')
  .description('Configure blocked tools for the current repository')
  .action(async () => {
    const repoPath = process.cwd();
    await configManager.promptForRepoBlockedTools(repoPath);
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
  .command('configure-review-agent')
  .description('Configure which bot to tag for PR review requests (default: @codex)')
  .action(async () => {
    await configManager.promptForReviewAgent();
  });

program
  .command('add-action')
  .description('Add Ivan Agent GitHub Action workflow to current repository')
  .action(async () => {
    await addIvanAction();
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
    const blockedTools = await configManager.getRepoBlockedTools(repoPath);
    const instructions = await configManager.getRepoInstructions(repoPath);

    console.log(chalk.cyan('Allowed Tools:'));
    if (allowedTools) {
      console.log('  ' + allowedTools.join(', '));
    } else {
      console.log(chalk.gray('  [*] (all tools allowed - default)'));
    }

    console.log('');
    console.log(chalk.cyan('Blocked Tools:'));
    if (blockedTools && blockedTools.length > 0) {
      console.log('  ' + blockedTools.join(', '));
    } else {
      console.log(chalk.gray('  (none configured)'));
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
    const model = config.claudeModel || 'claude-sonnet-4-5-20250929';
    console.log('  ' + model);

    console.log('');
    console.log(chalk.cyan('Executor Type:'));
    const executorType = config.executorType || 'sdk';
    console.log('  ' + executorType.toUpperCase());

    console.log('');
    console.log(chalk.cyan('Review Agent:'));
    const reviewAgent = configManager.getReviewAgent();
    console.log('  ' + reviewAgent);
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

async function addIvanAction(): Promise<void> {
  try {
    const workingDir = process.cwd();
    const workflowDir = join(workingDir, '.github', 'workflows');
    const workflowPath = join(workflowDir, 'ivanagent.yml');

    console.log(chalk.blue.bold('🚀 Adding Ivan Agent GitHub Action'));
    console.log('');

    // Check if workflow already exists
    if (existsSync(workflowPath)) {
      console.log(chalk.yellow('⚠️  Ivan Agent workflow already exists at .github/workflows/ivanagent.yml'));
      console.log(chalk.gray('Skipping workflow creation'));
      return;
    }

    // Check if we're in a git repository
    try {
      execSync('git rev-parse --git-dir', { stdio: 'pipe' });
    } catch {
      console.log(chalk.red('❌ Not in a git repository'));
      console.log(chalk.gray('Please run this command from a git repository'));
      return;
    }

    // Stash any current changes
    console.log(chalk.blue('📦 Stashing current changes...'));
    try {
      const stashResult = execSync('git stash push -m "Stashing changes before adding Ivan Action"', {
        encoding: 'utf-8',
        stdio: 'pipe'
      });
      const hasStashed = !stashResult.includes('No local changes to save');
      if (hasStashed) {
        console.log(chalk.green('✓ Changes stashed'));
      } else {
        console.log(chalk.gray('No changes to stash'));
      }
    } catch (error) {
      console.log(chalk.yellow('⚠️  Could not stash changes, continuing anyway'));
    }

    // Checkout main branch
    console.log(chalk.blue('🔄 Checking out main branch...'));
    try {
      const currentBranch = execSync('git branch --show-current', { encoding: 'utf-8' }).trim();
      if (currentBranch !== 'main') {
        execSync('git checkout main', { stdio: 'pipe' });
        console.log(chalk.green('✓ Checked out main'));
      } else {
        console.log(chalk.gray('Already on main'));
      }
    } catch (error) {
      console.log(chalk.red('❌ Failed to checkout main branch'));
      throw error;
    }

    // Create new branch
    const branchName = 'add-ivan-action-workflow';
    console.log(chalk.blue(`🌿 Creating new branch: ${branchName}...`));
    try {
      // Check if branch already exists
      try {
        execSync(`git rev-parse --verify ${branchName}`, { stdio: 'pipe' });
        console.log(chalk.yellow(`⚠️  Branch ${branchName} already exists, switching to it`));
        execSync(`git checkout ${branchName}`, { stdio: 'pipe' });
      } catch {
        // Branch doesn't exist, create it
        execSync(`git checkout -b ${branchName}`, { stdio: 'pipe' });
        console.log(chalk.green('✓ Branch created'));
      }
    } catch (error) {
      console.log(chalk.red('❌ Failed to create branch'));
      throw error;
    }

    // Create workflows directory if it doesn't exist
    if (!existsSync(workflowDir)) {
      console.log(chalk.blue('📁 Creating .github/workflows directory...'));
      mkdirSync(workflowDir, { recursive: true });
      console.log(chalk.green('✓ Directory created'));
    }

    // Get the path to the workflow file in the package
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const packageWorkflowPath = join(__dirname, '..', '.github', 'workflows', 'ivanagent.yml');

    // Copy the workflow file
    console.log(chalk.blue('📋 Adding workflow file...'));
    copyFileSync(packageWorkflowPath, workflowPath);
    console.log(chalk.green('✓ Workflow file added'));

    // Git add the file
    console.log(chalk.blue('📝 Staging workflow file...'));
    execSync('git add .github/workflows/ivanagent.yml', { stdio: 'pipe' });
    console.log(chalk.green('✓ File staged'));

    // Commit the changes
    console.log(chalk.blue('💾 Committing changes...'));
    execSync('git commit -m "Add Ivan Agent GitHub Action workflow"', { stdio: 'pipe' });
    console.log(chalk.green('✓ Changes committed'));

    // Push the branch
    console.log(chalk.blue('⬆️  Pushing branch to remote...'));
    try {
      execSync(`git push -u origin ${branchName}`, { stdio: 'pipe' });
      console.log(chalk.green('✓ Branch pushed'));
    } catch (error) {
      console.log(chalk.red('❌ Failed to push branch'));
      throw error;
    }

    // Create PR
    console.log(chalk.blue('🔀 Creating pull request...'));
    try {
      const prBody = `This PR adds the Ivan Agent GitHub Action workflow.

## What does this do?

This workflow allows you to trigger Ivan Agent by commenting \`@ivan-agent\` on any GitHub issue. Ivan will then:
- Read the issue description
- Create a plan to address it
- Implement the solution
- Open a PR with the changes

## Required Setup

After merging this PR, you'll need to set up the following GitHub secrets in your repository:
- \`OPEN_AI_KEY\`: Your OpenAI API key
- \`ANTHROPIC_KEY\`: Your Anthropic API key
- \`PAT\`: A Personal Access Token with repo permissions

You'll also need to create a GitHub environment named \`ivan\` in your repository settings.`;

      const prUrl = execSync(
        `gh pr create --title "Add Ivan Agent GitHub Action workflow" --body "${prBody.replace(/"/g, '\\"')}"`,
        { encoding: 'utf-8', stdio: 'pipe' }
      ).trim();

      console.log('');
      console.log(chalk.green.bold('✅ Pull request created successfully!'));
      console.log(chalk.cyan(`🔗 ${prUrl}`));
      console.log('');
      console.log(chalk.gray('Next steps:'));
      console.log(chalk.gray('1. Review and merge the PR'));
      console.log(chalk.gray('2. Set up the required GitHub secrets (OPEN_AI_KEY, ANTHROPIC_KEY, PAT)'));
      console.log(chalk.gray('3. Create a GitHub environment named "ivan"'));
      console.log(chalk.gray('4. Comment @ivan-agent on any issue to trigger Ivan!'));
    } catch (error) {
      console.log(chalk.red('❌ Failed to create pull request'));
      console.log(chalk.yellow('You can create it manually from the branch:', branchName));
      throw error;
    }

  } catch (error) {
    console.error(chalk.red('❌ Error adding Ivan Action:'), error);
    process.exit(1);
  }
}

async function runNonInteractive(configInput: string): Promise<void> {
  try {
    let config: NonInteractiveConfig;
    let configSource: string;

    // Try to parse as JSON first (inline JSON)
    try {
      config = JSON.parse(configInput);
      configSource = 'inline JSON';
    } catch {
      // If parsing fails, treat as file path
      const configContent = readFileSync(configInput, 'utf-8');
      config = JSON.parse(configContent);
      configSource = configInput;
    }

    // Validate config
    if (!config.tasks || !Array.isArray(config.tasks) || config.tasks.length === 0) {
      throw new Error('Config must have a "tasks" array with at least one task');
    }

    console.log(chalk.blue.bold('🤖 Running in non-interactive mode'));
    console.log(chalk.gray(`Config: ${configSource}`));
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

    if (args.length === 0 || (args.length === 1 && !['reconfigure', 'config-tools', 'config-blocked-tools', 'edit-repo-instructions', 'show-config', 'choose-model', 'configure-executor', 'configure-review-agent', 'add-action', 'web', 'web-stop', 'address', '--help', '-h', '--version', '-V'].includes(args[0]))) {
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