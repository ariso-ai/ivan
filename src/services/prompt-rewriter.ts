import chalk from 'chalk';
import { OpenAIService } from './openai-service.js';
import { IClaudeExecutor } from './executor-factory.js';

export interface RewriteResult {
  original: string;
  rewritten: string;
  questions: string[];
  research: string;
}

export class PromptRewriter {
  private openaiService: OpenAIService;
  private claudeExecutor: IClaudeExecutor;
  private workingDir: string;
  private quiet: boolean;

  constructor(openaiService: OpenAIService, claudeExecutor: IClaudeExecutor, workingDir: string, quiet: boolean = false) {
    this.openaiService = openaiService;
    this.claudeExecutor = claudeExecutor;
    this.workingDir = workingDir;
    this.quiet = quiet;
  }

  async rewrite(originalTicket: string): Promise<RewriteResult> {
    // Step 1: Extract research questions (ticket -> questions)
    // This is the ONLY step that sees the original ticket
    if (!this.quiet) console.log(chalk.blue('  Step 1/3: Extracting research questions...'));
    const questions = await this.openaiService.extractResearchQuestions(originalTicket);
    if (!this.quiet) console.log(chalk.gray(`  Found ${questions.length} research questions`));

    // Step 2: Claude Code explores the target repo using the questions
    // NOTE: originalTicket is NOT passed here - preventing intent leakage
    if (!this.quiet) console.log(chalk.blue('  Step 2/3: Claude Code researching codebase...'));
    const research = await this.runClaudeResearch(questions);
    if (!this.quiet) console.log(chalk.gray('  Research complete'));

    // Step 3: Rewrite (ticket + research -> structured prompt via Anthropic SDK)
    if (!this.quiet) console.log(chalk.blue('  Step 3/3: Rewriting prompt...'));
    const rewritten = await this.runClaudeRewrite(originalTicket, research);
    if (!this.quiet) console.log(chalk.green('  Prompt rewriting complete'));

    return { original: originalTicket, rewritten, questions, research };
  }

  private async runClaudeRewrite(originalTicket: string, research: string): Promise<string> {
    const rewritePrompt = `You are a prompt optimizer for coding agents. You have been given:
1. An original development ticket (often verbose, with noise)
2. Objective research findings about the relevant codebase

Produce a clean, structured prompt optimized for a coding agent (Claude Code).

OUTPUT FORMAT (use this exact structure):
## Task
[Clear, specific statement of what to implement/fix]

## Current Behavior
[Only if bug fix - what happens now, concisely]

## Expected Behavior
[What should happen after implementation]

## Relevant Files
[From the research - actual file paths and functions found in the codebase]

## Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2

## Constraints
[Technical constraints or patterns to follow, informed by the research]

NOISE TO REMOVE:
- Slack metadata (channel IDs, "Reported by:", "Requested by:", usernames)
- Assignee directives ("@ivan-agent /build", "Please assign to")
- Generic boilerplate ("This issue was created by Ari...", "Implementation Notes")
- Speculative codebase context ("I searched but didn't find...")
- Duplicate explanations of the same thing

INFORMATION TO PRESERVE:
- The actual problem/feature description
- Acceptance criteria (make them checkboxes)
- Technical constraints
- File paths and function names (especially ones verified by research)
- Specific behavior descriptions (current vs expected)

Do NOT use any tools. Do NOT read any files. Output ONLY the rewritten prompt.

Original Ticket:
${originalTicket}

Codebase Research Findings:
${research}`;

    try {
      const result = await this.claudeExecutor.executeTask(rewritePrompt, this.workingDir);
      return result.log || result.lastMessage || originalTicket;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`Prompt rewrite failed: ${msg}, using original`);
      return originalTicket;
    }
  }

  private async runClaudeResearch(questions: string[]): Promise<string> {
    const questionsText = questions.map((q, i) => `${i + 1}. ${q}`).join('\n');

    const researchPrompt = `You are a codebase researcher. Answer the following questions by exploring this repository using Glob, Grep, and Read tools.

IMPORTANT RULES:
- Do NOT modify any files
- Do NOT write any code
- Do NOT make any changes to the codebase
- ONLY use Glob, Grep, and Read to find and read files
- Answer each question with factual findings from the code
- If something is not found, say so explicitly
- Include file paths and line numbers in your answers

Research Questions:
${questionsText}

For each question, explore the codebase and provide a factual answer based on what you find. Focus on:
- Exact file locations
- Function/method signatures
- Data structures and types
- Import/dependency relationships
- Existing patterns and conventions`;

    try {
      const result = await this.claudeExecutor.executeTask(researchPrompt, this.workingDir);
      return result.log || result.lastMessage;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return `Research failed: ${msg}`;
    }
  }
}
