import OpenAI from 'openai';
import { ConfigManager } from '../config.js';

export class OpenAIService {
  private openai: OpenAI;

  constructor() {
    const configManager = new ConfigManager();
    const config = configManager.getConfig();
    
    if (!config?.openaiApiKey) {
      throw new Error('OpenAI API key not found in configuration');
    }

    this.openai = new OpenAI({
      apiKey: config.openaiApiKey
    });
  }

  async generateCommitMessage(diff: string, changedFiles: string[]): Promise<string> {
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
      const response = await this.openai.chat.completions.create({
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
1. A concise PR title (under 60 characters)
2. A detailed PR description with:
   - Summary of changes
   - What was implemented
   - Any notable details

Format your response as JSON:
{
  "title": "PR title here",
  "body": "PR description here"
}`;

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 500,
        temperature: 0.3
      });

      const content = response.choices[0]?.message?.content?.trim();
      if (!content) {
        throw new Error('No PR description generated');
      }

      const parsed = JSON.parse(content);
      return {
        title: parsed.title || taskDescription,
        body: parsed.body || `Implemented: ${taskDescription}\n\n🤖 Generated with Ivan`
      };
    } catch (error) {
      console.error('Failed to generate PR description:', error);
      return {
        title: taskDescription,
        body: `Implemented: ${taskDescription}\n\nChanged files:\n${changedFiles.map(file => `- ${file}`).join('\n')}\n\n🤖 Generated with Ivan`
      };
    }
  }
}