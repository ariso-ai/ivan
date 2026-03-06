import chalk from 'chalk';
import { OpenAIService } from './openai-service.js';

export interface RewriteResult {
  original: string;
  rewritten: string;
}

export class PromptRewriter {
  private openaiService: OpenAIService;
  private quiet: boolean;

  constructor(openaiService: OpenAIService, quiet: boolean = false) {
    this.openaiService = openaiService;
    this.quiet = quiet;
  }

  async rewrite(originalTicket: string): Promise<RewriteResult> {
    if (!this.quiet) console.log(chalk.blue('  Rewriting prompt...'));
    const rewritten = await this.openaiService.rewritePrompt(originalTicket);
    if (!this.quiet) console.log(chalk.green('  Prompt rewriting complete'));
    return { original: originalTicket, rewritten };
  }
}
