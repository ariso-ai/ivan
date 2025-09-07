import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { DatabaseManager } from './database.js';

interface Config {
  openaiApiKey: string;
  version: string;
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
    try {
      execSync('claude --version', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  async setup(): Promise<void> {
    console.log(chalk.blue.bold('🤖 Ivan Configuration Setup'));
    console.log('');

    if (!this.isClaudeCodeInstalled()) {
      console.log(chalk.red('❌ Claude Code CLI is not installed or not in PATH'));
      console.log(chalk.yellow('Please install Claude Code CLI first:'));
      console.log(chalk.cyan('npm install -g @anthropics/claude-cli'));
      console.log('or visit: https://docs.anthropic.com/claude/docs/claude-cli');
      process.exit(1);
    }

    console.log(chalk.green('✅ Claude Code CLI is installed'));
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
      }
    ]);

    const config: Config = {
      openaiApiKey: answers.openaiApiKey.trim(),
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
}