import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { DatabaseManager } from '../database/database.js';

const execAsync = promisify(exec);

export interface IvanConfig {
  openAiApiKey: string;
  anthropicApiKey: string;
  repository: string;
}

export class ConfigManager {
  private configDir: string;
  private configPath: string;
  private dbManager: DatabaseManager;

  constructor() {
    this.configDir = path.join(os.homedir(), '.ivan');
    this.configPath = path.join(this.configDir, 'config.json');
    this.dbManager = new DatabaseManager();
  }

  public async initialize(): Promise<IvanConfig> {
    await this.dbManager.initialize();

    const existingConfig = this.loadConfig();

    if (existingConfig) {
      console.log(chalk.green('✓ Configuration found!'));
      return existingConfig;
    }

    console.log(chalk.cyan('\n🤖 Welcome to Ivan - Your Coding Orchestration Agent\n'));
    console.log(chalk.yellow('Let\'s set up your configuration...\n'));

    await this.checkClaudeCodeInstallation();
    await this.dbManager.initialize();

    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'repository',
        message: 'Enter the SSH repository URL (e.g., git@github.com:user/repo.git):',
        validate: (input: string) => {
          if (!input || input.trim() === '') {
            return 'Repository URL is required';
          }

          const trimmed = input.trim();
          const sshUrlPattern = /^git@[\w.-]+:[\w.-]+\/[\w.-]+\.git$/;

          if (!sshUrlPattern.test(trimmed)) {
            return 'Please enter a valid SSH repository URL (e.g., git@github.com:user/repo.git)';
          }

          return true;
        },
        filter: (input: string) => input.trim()
      },
      {
        type: 'password',
        name: 'openAiApiKey',
        message: 'Enter your OpenAI API key (for commit messages):',
        mask: '*',
        validate: (input: string) => {
          if (!input || input.trim() === '') {
            return 'OpenAI API key is required';
          }
          return true;
        }
      },
      {
        type: 'password',
        name: 'anthropicApiKey',
        message: 'Enter your Anthropic API key (for task planning):',
        mask: '*',
        validate: (input: string) => {
          if (!input || input.trim() === '') {
            return 'Anthropic API key is required';
          }
          return true;
        }
      }
    ]);

    const config: IvanConfig = {
      repository: answers.repository,
      openAiApiKey: answers.openAiApiKey,
      anthropicApiKey: answers.anthropicApiKey
    };

    this.saveConfig(config);
    console.log(chalk.green('\n✓ Configuration saved successfully!\n'));

    return config;
  }

  private loadConfig(): IvanConfig | null {
    try {
      if (fs.existsSync(this.configPath)) {
        const configData = fs.readFileSync(this.configPath, 'utf-8');
        return JSON.parse(configData) as IvanConfig;
      }
    } catch (error) {
      console.error(chalk.red('Error loading configuration:'), error);
    }
    return null;
  }

  private saveConfig(config: IvanConfig): void {
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }

    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2));
  }

  public getConfig(): IvanConfig | null {
    return this.loadConfig();
  }

  public getDatabase(): DatabaseManager {
    return this.dbManager;
  }

  public async forceReconfigure(): Promise<IvanConfig> {
    console.log(chalk.cyan('\n🔧 Reconfiguring Ivan...\n'));

    await this.dbManager.initialize();
    await this.checkClaudeCodeInstallation();

    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'repository',
        message: 'Enter the SSH repository URL (e.g., git@github.com:user/repo.git):',
        validate: (input: string) => {
          if (!input || input.trim() === '') {
            return 'Repository URL is required';
          }

          const trimmed = input.trim();
          const sshUrlPattern = /^git@[\w.-]+:[\w.-]+\/[\w.-]+\.git$/;

          if (!sshUrlPattern.test(trimmed)) {
            return 'Please enter a valid SSH repository URL (e.g., git@github.com:user/repo.git)';
          }

          return true;
        },
        filter: (input: string) => input.trim()
      },
      {
        type: 'password',
        name: 'openAiApiKey',
        message: 'Enter your OpenAI API key (for commit messages):',
        mask: '*',
        validate: (input: string) => {
          if (!input || input.trim() === '') {
            return 'OpenAI API key is required';
          }
          return true;
        }
      },
      {
        type: 'password',
        name: 'anthropicApiKey',
        message: 'Enter your Anthropic API key (for task planning):',
        mask: '*',
        validate: (input: string) => {
          if (!input || input.trim() === '') {
            return 'Anthropic API key is required';
          }
          return true;
        }
      }
    ]);

    const config: IvanConfig = {
      repository: answers.repository,
      openAiApiKey: answers.openAiApiKey,
      anthropicApiKey: answers.anthropicApiKey
    };

    this.saveConfig(config);
    console.log(chalk.green('\n✓ Configuration updated successfully!\n'));

    return config;
  }

  private async checkClaudeCodeInstallation(): Promise<void> {
    try {
      console.log(chalk.gray('🔍 Checking for Claude Code installation...'));
      const { stdout } = await execAsync('claude --version');
      console.log(chalk.green('✓ Claude Code is installed'));
      console.log(chalk.gray(`  Version: ${stdout.trim()}\n`));
    } catch {
      console.log(chalk.red('✗ Claude Code not found'));
      console.log(chalk.yellow('  Please install Claude Code from: https://docs.anthropic.com/en/docs/claude-code\n'));

      const { continueAnyway } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'continueAnyway',
          message: 'Continue setup without Claude Code?',
          default: false
        }
      ]);

      if (!continueAnyway) {
        console.log(chalk.yellow('\n👋 Setup cancelled. Install Claude Code and try again.\n'));
        process.exit(0);
      }
    }
  }
}

