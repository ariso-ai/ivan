import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { DatabaseManager } from './database.js';

interface Config {
  openaiApiKey: string;
  anthropicApiKey: string;
  version: string;
  repoInstructions?: { [repoPath: string]: string };
}

export class ConfigManager {
  private configDir: string;
  private configPath: string;
  private dbPath: string;

  constructor() {
    this.configDir = path.join(os.homedir(), '.ivan');
    this.configPath = path.join(this.configDir, 'config.json');
    this.dbPath = path.join(this.configDir, 'db.sqlite');
  }

  private ensureConfigDir(): void {
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }
  }

  private async ensureDatabase(): Promise<void> {
    if (!fs.existsSync(this.dbPath)) {
      fs.writeFileSync(this.dbPath, '');
      console.log(chalk.green('✅ Database created'));
    }
    
    const dbManager = new DatabaseManager();
    try {
      await dbManager.runMigrations();
    } finally {
      dbManager.close();
    }
  }

  isConfigured(): boolean {
    return fs.existsSync(this.configPath);
  }

  getConfig(): Config | null {
    if (!this.isConfigured()) {
      return null;
    }

    try {
      const configData = fs.readFileSync(this.configPath, 'utf8');
      return JSON.parse(configData) as Config;
    } catch (error) {
      console.error(chalk.red('Error reading config file:'), error);
      return null;
    }
  }

  private async saveConfig(config: Config): Promise<void> {
    this.ensureConfigDir();
    await this.ensureDatabase();
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2));
      console.log(chalk.green('Configuration saved successfully!'));
    } catch (error) {
      console.error(chalk.red('Error saving config:'), error);
      throw error;
    }
  }

  isClaudeCodeInstalled(): boolean {
    // No longer needed with SDK
    return true;
  }

  async setup(): Promise<void> {
    console.log(chalk.blue.bold('🤖 Ivan Configuration Setup'));
    console.log('');

    const answers = await inquirer.prompt([
      {
        type: 'password',
        name: 'openaiApiKey',
        message: 'Enter your OpenAI API key:',
        validate: (input: string) => {
          if (!input || input.trim().length === 0) {
            return 'OpenAI API key is required';
          }
          if (!input.startsWith('sk-')) {
            return 'OpenAI API key should start with "sk-"';
          }
          return true;
        },
        mask: '*'
      },
      {
        type: 'password',
        name: 'anthropicApiKey',
        message: 'Enter your Anthropic API key:',
        validate: (input: string) => {
          if (!input || input.trim().length === 0) {
            return 'Anthropic API key is required';
          }
          if (!input.startsWith('sk-ant-')) {
            return 'Anthropic API key should start with "sk-ant-"';
          }
          return true;
        },
        mask: '*'
      }
    ]);

    const config: Config = {
      openaiApiKey: answers.openaiApiKey.trim(),
      anthropicApiKey: answers.anthropicApiKey.trim(),
      version: '1.0.0'
    };

    await this.saveConfig(config);
    console.log('');
    console.log(chalk.green('🎉 Ivan is now configured and ready to use!'));
  }

  async reconfigure(): Promise<void> {
    console.log(chalk.blue.bold('🔧 Ivan Reconfiguration'));
    console.log('');

    if (this.isConfigured()) {
      const currentConfig = this.getConfig();
      if (currentConfig) {
        console.log(chalk.yellow('Current configuration found.'));
      }
    }

    await this.setup();
  }

  async getRepoInstructions(repoPath: string): Promise<string | undefined> {
    const config = this.getConfig();
    if (!config || !config.repoInstructions) {
      return undefined;
    }
    return config.repoInstructions[repoPath];
  }

  async setRepoInstructions(repoPath: string, instructions: string): Promise<void> {
    const config = this.getConfig();
    if (!config) {
      throw new Error('Configuration not found');
    }

    if (!config.repoInstructions) {
      config.repoInstructions = {};
    }

    config.repoInstructions[repoPath] = instructions;
    await this.saveConfig(config);
  }

  async promptForMissingConfig(configKey: 'openaiApiKey' | 'anthropicApiKey'): Promise<string> {
    console.log(chalk.yellow(`⚠️  ${configKey === 'openaiApiKey' ? 'OpenAI' : 'Anthropic'} API key is missing or invalid.`));
    console.log('');

    const promptConfig = configKey === 'openaiApiKey' ? {
      type: 'password' as const,
      name: 'apiKey',
      message: 'Enter your OpenAI API key:',
      validate: (input: string) => {
        if (!input || input.trim().length === 0) {
          return 'OpenAI API key is required';
        }
        if (!input.startsWith('sk-')) {
          return 'OpenAI API key should start with "sk-"';
        }
        return true;
      },
      mask: '*'
    } : {
      type: 'password' as const,
      name: 'apiKey',
      message: 'Enter your Anthropic API key:',
      validate: (input: string) => {
        if (!input || input.trim().length === 0) {
          return 'Anthropic API key is required';
        }
        if (!input.startsWith('sk-ant-')) {
          return 'Anthropic API key should start with "sk-ant-"';
        }
        return true;
      },
      mask: '*'
    };

    const answers = await inquirer.prompt([promptConfig]);
    const apiKey = answers.apiKey.trim();

    // Update the configuration
    let config = this.getConfig();
    if (!config) {
      config = {
        openaiApiKey: '',
        anthropicApiKey: '',
        version: '1.0.0'
      };
    }

    config[configKey] = apiKey;
    await this.saveConfig(config);

    console.log(chalk.green(`✅ ${configKey === 'openaiApiKey' ? 'OpenAI' : 'Anthropic'} API key saved successfully!`));
    console.log('');

    return apiKey;
  }

  async promptForRepoInstructions(repoPath: string): Promise<string> {
    console.log(chalk.blue.bold('📝 Repository-Specific Instructions'));
    console.log(chalk.gray(`Repository: ${repoPath}`));
    console.log('');
    console.log(chalk.yellow('You can set repository-specific instructions that will be appended to every task.'));
    console.log(chalk.gray('Examples: coding style guidelines, frameworks to use, patterns to follow, etc.'));
    console.log('');

    const answers = await inquirer.prompt([
      {
        type: 'editor',
        name: 'instructions',
        message: 'Enter repository-specific instructions (press Enter to open editor):',
        default: '# Repository-specific instructions\n# These will be appended to every task in this repository\n# Examples:\n# - Use TypeScript for all new files\n# - Follow existing patterns for error handling\n# - Add comprehensive tests for new features\n',
        validate: (input: string) => {
          const cleanedInput = input.replace(/^#.*$/gm, '').trim();
          if (cleanedInput.length === 0) {
            return 'Please provide some instructions or press Ctrl+C to skip';
          }
          return true;
        }
      }
    ]);

    const cleanedInstructions = answers.instructions
      .split('\n')
      .filter((line: string) => !line.trim().startsWith('#'))
      .join('\n')
      .trim();

    if (cleanedInstructions) {
      await this.setRepoInstructions(repoPath, cleanedInstructions);
      console.log(chalk.green('✅ Repository instructions saved'));
    }

    return cleanedInstructions;
  }
}