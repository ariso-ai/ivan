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
  claudeModel?: string;
  executorType?: 'sdk' | 'cli';
  reviewAgent?: string;
  repoInstructions?: { [repoPath: string]: string };
  repoAllowedTools?: { [repoPath: string]: string[] };
  repoInstructionsDeclined?: { [repoPath: string]: boolean };
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

  private isGhInstalled(): boolean {
    try {
      execSync('gh --version', { stdio: 'ignore' });
      return true;
    } catch (error) {
      return false;
    }
  }

  private isGhAuthenticated(): boolean {
    try {
      execSync('gh auth status', { stdio: 'ignore' });
      return true;
    } catch (error) {
      return false;
    }
  }

  private async checkGhAuth(): Promise<void> {
    // Check if gh CLI is installed
    if (!this.isGhInstalled()) {
      console.log(chalk.yellow('⚠️  GitHub CLI (gh) is not installed.'));
      console.log(chalk.gray('Ivan uses gh to create pull requests.'));
      console.log('');
      console.log(chalk.cyan('To install gh:'));
      console.log(chalk.gray('  • macOS: brew install gh'));
      console.log(chalk.gray('  • Other: https://cli.github.com/'));
      console.log('');

      const { continueWithoutGh } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'continueWithoutGh',
          message: 'Continue setup without GitHub CLI?',
          default: false
        }
      ]);

      if (!continueWithoutGh) {
        console.log(chalk.red('Setup cancelled. Please install gh and try again.'));
        process.exit(0);
      }

      console.log('');
      return;
    }

    // Check if gh is authenticated
    if (!this.isGhAuthenticated()) {
      console.log(chalk.yellow('⚠️  GitHub CLI is not authenticated.'));
      console.log(chalk.gray('Ivan uses gh to create pull requests.'));
      console.log('');
      console.log(chalk.cyan('Please authenticate with GitHub:'));
      console.log(chalk.gray('  Run: gh auth login'));
      console.log('');

      const { readyToContinue } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'readyToContinue',
          message: 'Have you completed gh auth login?',
          default: false
        }
      ]);

      if (!readyToContinue) {
        console.log(chalk.red('Setup cancelled. Please authenticate with gh and try again.'));
        process.exit(0);
      }

      // Verify authentication after user claims to have done it
      if (!this.isGhAuthenticated()) {
        console.log(chalk.red('❌ GitHub CLI is still not authenticated.'));
        console.log(chalk.yellow('Please run "gh auth login" and then run "ivan" again.'));
        process.exit(1);
      }

      console.log(chalk.green('✅ GitHub CLI is authenticated!'));
      console.log('');
    }
  }

  async setup(): Promise<void> {
    console.log(chalk.blue.bold('🤖 Ivan Configuration Setup'));
    console.log('');

    // Check GitHub CLI authentication
    await this.checkGhAuth();

    // First ask about executor type
    const executorAnswers = await inquirer.prompt([
      {
        type: 'list',
        name: 'executorType',
        message: 'How do you want to run Claude Code?',
        choices: [
          {
            name: 'SDK - Use Anthropic API directly (requires API key)',
            value: 'sdk' as const
          },
          {
            name: 'CLI - Use Claude Code CLI installed on your machine (for Claude Max users)',
            value: 'cli' as const
          }
        ],
        default: 'sdk'
      }
    ]);

    const executorType = executorAnswers.executorType;

    // Build questions based on executor type
    const questions: any[] = [
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
    ];

    // Only ask for Anthropic API key if using SDK executor
    if (executorType === 'sdk') {
      questions.push({
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
      });
    }

    const answers = await inquirer.prompt(questions);

    const config: Config = {
      openaiApiKey: answers.openaiApiKey.trim(),
      anthropicApiKey: executorType === 'sdk' ? answers.anthropicApiKey.trim() : '',
      version: '1.0.0',
      executorType: executorType
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

  async hasDeclinedRepoInstructions(repoPath: string): Promise<boolean> {
    const config = this.getConfig();
    if (!config || !config.repoInstructionsDeclined) {
      return false;
    }
    return config.repoInstructionsDeclined[repoPath] === true;
  }

  async markRepoInstructionsDeclined(repoPath: string): Promise<void> {
    const config = this.getConfig();
    if (!config) {
      throw new Error('Configuration not found');
    }

    if (!config.repoInstructionsDeclined) {
      config.repoInstructionsDeclined = {};
    }

    config.repoInstructionsDeclined[repoPath] = true;
    await this.saveConfig(config);
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

  async getRepoAllowedTools(repoPath: string): Promise<string[] | undefined> {
    const config = this.getConfig();
    if (!config || !config.repoAllowedTools) {
      return undefined;
    }
    return config.repoAllowedTools[repoPath];
  }

  async setRepoAllowedTools(repoPath: string, allowedTools: string[]): Promise<void> {
    const config = this.getConfig();
    if (!config) {
      throw new Error('Configuration not found');
    }

    if (!config.repoAllowedTools) {
      config.repoAllowedTools = {};
    }

    config.repoAllowedTools[repoPath] = allowedTools;
    await this.saveConfig(config);
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

  async promptForRepoAllowedTools(repoPath: string): Promise<string[]> {
    console.log(chalk.blue.bold('🔧 Repository-Specific Tool Configuration'));
    console.log(chalk.gray(`Repository: ${repoPath}`));
    console.log('');
    console.log(chalk.yellow('Configure which tools Claude Code can use in this repository.'));
    console.log(chalk.gray('Default: All tools allowed (["*"])'));
    console.log(chalk.gray('Examples: ["Bash", "Read", "Write", "Edit"] or ["*"] for all tools'));
    console.log('');

    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'allowedTools',
        message: 'Enter allowed tools (comma-separated, or * for all):',
        default: '*',
        validate: (input: string) => {
          const trimmed = input.trim();
          if (trimmed.length === 0) {
            return 'Please provide at least one tool or * for all';
          }
          return true;
        },
        filter: (input: string) => {
          const trimmed = input.trim();
          if (trimmed === '*') {
            return ['*'];
          }
          return trimmed.split(',').map(tool => tool.trim()).filter(tool => tool.length > 0);
        }
      }
    ]);

    const allowedTools = answers.allowedTools;

    if (allowedTools.length > 0) {
      await this.setRepoAllowedTools(repoPath, allowedTools);
      console.log(chalk.green('✅ Repository tool configuration saved'));
    }

    return allowedTools;
  }

  async promptForModel(): Promise<void> {
    console.log(chalk.blue.bold('🤖 Choose Claude Model'));
    console.log('');
    console.log(chalk.yellow('Select which Claude model to use for code tasks'));
    console.log('');

    const models = [
      {
        name: 'Claude Sonnet 4.5 - Recommended for most tasks',
        value: 'claude-sonnet-4-5-20250929',
        short: 'Claude Sonnet 4.5'
      },
      {
        name: 'Claude 3.5 Haiku - Faster, good for simpler tasks',
        value: 'claude-3-5-haiku-20241022',
        short: 'Claude 3.5 Haiku'
      },
      {
        name: 'Claude Opus 4.1 - Most capable, but slower',
        value: 'claude-opus-4-1-20250805',
        short: 'Claude Opus 4.1'
      }
    ];

    const answers = await inquirer.prompt([
      {
        type: 'list',
        name: 'model',
        message: 'Select Claude model:',
        choices: models,
        default: 'claude-sonnet-4-5-20250929'
      }
    ]);

    const config = this.getConfig();
    if (!config) {
      throw new Error('Configuration not found');
    }

    config.claudeModel = answers.model;
    await this.saveConfig(config);

    const selectedModel = models.find(m => m.value === answers.model);
    console.log('');
    console.log(chalk.green(`✅ Model set to: ${selectedModel?.short || answers.model}`));
  }

  getClaudeModel(): string {
    const config = this.getConfig();
    return config?.claudeModel || 'claude-sonnet-4-5-20250929';
  }

  async promptForExecutorType(): Promise<void> {
    console.log(chalk.blue.bold('🔧 Choose Claude Executor'));
    console.log('');
    console.log(chalk.yellow('Select how you want to run Claude Code'));
    console.log('');

    const executors = [
      {
        name: 'SDK - Use Anthropic API directly (requires API key)',
        value: 'sdk' as const,
        short: 'SDK'
      },
      {
        name: 'CLI - Use Claude Code CLI installed on your machine (for Claude Max users)',
        value: 'cli' as const,
        short: 'CLI'
      }
    ];

    const answers = await inquirer.prompt([
      {
        type: 'list',
        name: 'executorType',
        message: 'Select executor type:',
        choices: executors,
        default: 'sdk'
      }
    ]);

    const config = this.getConfig();
    if (!config) {
      throw new Error('Configuration not found');
    }

    config.executorType = answers.executorType;
    await this.saveConfig(config);

    const selectedExecutor = executors.find(e => e.value === answers.executorType);
    console.log('');
    console.log(chalk.green(`✅ Executor set to: ${selectedExecutor?.short || answers.executorType}`));
  }

  getExecutorType(): 'sdk' | 'cli' {
    const config = this.getConfig();
    return config?.executorType || 'sdk';
  }

  async setExecutorType(executorType: 'sdk' | 'cli'): Promise<void> {
    const config = this.getConfig();
    if (!config) {
      throw new Error('Configuration not found');
    }

    config.executorType = executorType;
    await this.saveConfig(config);
  }

  getReviewAgent(): string {
    const config = this.getConfig();
    return config?.reviewAgent || '@codex';
  }

  async setReviewAgent(reviewAgent: string): Promise<void> {
    const config = this.getConfig();
    if (!config) {
      throw new Error('Configuration not found');
    }

    config.reviewAgent = reviewAgent;
    await this.saveConfig(config);
  }

  async promptForReviewAgent(): Promise<void> {
    console.log(chalk.blue.bold('🤖 Configure Review Agent'));
    console.log('');
    console.log(chalk.yellow('Set the coding agent to tag in PR review request comments'));
    console.log(chalk.gray('This is the bot that will be mentioned to review your changes (e.g., @codex, @copilot)'));
    console.log('');

    const currentAgent = this.getReviewAgent();

    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'reviewAgent',
        message: 'Enter the review agent to tag (include @ symbol):',
        default: currentAgent,
        validate: (input: string) => {
          const trimmed = input.trim();
          if (trimmed.length === 0) {
            return 'Please provide a review agent name';
          }
          if (!trimmed.startsWith('@')) {
            return 'Review agent should start with @ (e.g., @codex)';
          }
          return true;
        }
      }
    ]);

    const reviewAgent = answers.reviewAgent.trim();
    await this.setReviewAgent(reviewAgent);

    console.log('');
    console.log(chalk.green(`✅ Review agent set to: ${reviewAgent}`));
  }
}