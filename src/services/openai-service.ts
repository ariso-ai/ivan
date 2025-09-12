import OpenAI from 'openai';
import { ConfigManager } from '../config.js';

export class OpenAIService {
  private openai: OpenAI | null = null;
  private configManager: ConfigManager;

  constructor() {
    this.configManager = new ConfigManager();
  }

  private async ensureInitialized(): Promise<void> {
    if (this.openai) return;

    let config = this.configManager.getConfig();

    if (!config?.openaiApiKey || config.openaiApiKey === '') {
      // Prompt for the API key
      const apiKey = await this.configManager.promptForMissingConfig('openaiApiKey');
      config = this.configManager.getConfig();
    }

    if (!config?.openaiApiKey) {
      throw new Error('Failed to obtain OpenAI API key');
    }

    this.openai = new OpenAI({
      apiKey: config.openaiApiKey
    });
  }

  async getClient(): Promise<OpenAI> {
    await this.ensureInitialized();
    return this.openai!;
  }

  async generateCommitMessage(diff: string, changedFiles: string[]): Promise<string> {
    await this.ensureInitialized();

    const prompt = `
Generate a concise git commit message for the following changes.

Changed files:
${changedFiles.map(file => `- ${file}`).join('\n')}

Git diff:
\`\`\`
${diff}
\`\`\`

Rules:
- Use conventional commit format (feat:, fix:, refactor:, etc.)
- Keep it under 50 characters for the subject line
- Focus on what was changed and why
- Be specific and clear

Return only the commit message, nothing else.`;

    try {
      const response = await this.openai!.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 100,
        temperature: 0.3
      });

      const message = response.choices[0]?.message?.content?.trim();
      if (!message) {
        throw new Error('No commit message generated');
      }

      return message;
    } catch (error) {
      console.error('Failed to generate commit message:', error);
      return 'chore: update code via Ivan';
    }
  }

  async generatePullRequestDescription(taskDescription: string, diff: string, changedFiles: string[]): Promise<{ title: string; body: string }> {
    await this.ensureInitialized();

    const prompt = `
Generate a pull request title and description for the following task and changes.

Task: ${taskDescription}

Changed files:
${changedFiles.map(file => `- ${file}`).join('\n')}

Git diff:
\`\`\`
${diff}
\`\`\`

Generate:
1. A concise PR title (MUST be under 250 characters to fit GitHub's 256 character limit)
2. A detailed PR description with:
   - Summary of changes
   - What was implemented
   - Any notable details`;

    try {
      const response = await this.openai!.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'pull_request',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                title: {
                  type: 'string',
                  description: 'The PR title (must be under 250 characters)'
                },
                body: {
                  type: 'string',
                  description: 'The PR description'
                }
              },
              required: ['title', 'body'],
              additionalProperties: false
            }
          }
        },
        max_tokens: 500,
        temperature: 0.3
      });

      const content = response.choices[0]?.message?.content?.trim();
      if (!content) {
        throw new Error('No PR description generated');
      }

      const parsed = JSON.parse(content);
      // Ensure title doesn't exceed GitHub's 256 character limit
      let title = `Ivan: ${parsed.title || taskDescription}`;
      if (title.length > 256) {
        title = title.substring(0, 253) + '...';
      }
      return {
        title,
        body: parsed.body || `Implemented: ${taskDescription}\n\n🤖 Generated with Ivan`
      };
    } catch (error) {
      console.error('Failed to generate PR description:', error);
      // Ensure fallback title doesn't exceed GitHub's 256 character limit
      let fallbackTitle = `Ivan: ${taskDescription}`;
      if (fallbackTitle.length > 256) {
        fallbackTitle = fallbackTitle.substring(0, 253) + '...';
      }
      return {
        title: fallbackTitle,
        body: `Implemented: ${taskDescription}\n\nChanged files:\n${changedFiles.map(file => `- ${file}`).join('\n')}\n\n🤖 Generated with Ivan`
      };
    }
  }
}
