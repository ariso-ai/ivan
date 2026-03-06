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
      await this.configManager.promptForMissingConfig('openaiApiKey');
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
    if (!this.openai) {
      throw new Error('OpenAI client not initialized');
    }
    return this.openai;
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
      if (!this.openai) {
        throw new Error('OpenAI client not initialized');
      }
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

  /**
   * Rewrite a verbose development ticket into a structured prompt optimized for coding agents.
   */
  async rewritePrompt(ticket: string): Promise<string> {
    const systemPrompt = `You rewrite noisy software-development tickets into execution-ready markdown prompts for an autonomous coding agent.

    The downstream coding agent has access to the full codebase and should be able to begin work without asking the user follow-up questions.

    Your job is to produce the smallest accurate prompt that:
    - preserves the real engineering ask,
    - makes the outcome observable and checkable,
    - avoids invented scope,
    - and records uncertainty without turning it into user-facing questions.

    RULES

    1. Source of truth
    - Use only information supported by the ticket.
    - Do not add net-new requirements, constraints, edge cases, file paths, implementation choices, or test plans.
    - You may make minimal direct restatements of the ask to express expected behavior and acceptance criteria.
    - Example: if the ticket says "fix crash when uploading PDFs", it is valid to write acceptance criteria like "Uploading PDFs no longer crashes in the reported flow."

    2. Preserve high-signal technical detail
    - Keep exact technical details verbatim when present: error messages, stack traces, endpoints, flags, config keys, filenames, module names, versions, logs, repro steps, metrics, and literal strings.
    - Preserve concrete clues even when the ticket presents them as guesses.

    3. Separate fact from speculation
    - Confirmed facts belong in: Task, Current Behavior, Expected Behavior, Acceptance Criteria, Constraints.
    - Speculative but actionable clues belong only in: Implementation Hints.
    - Explicit assumptions stated by the ticket author belong only in: Assumptions.
    - Never upgrade speculation into fact.

    4. Remove noise
    Remove:
    - Slack / PM metadata
    - assignee chatter
    - usernames
    - bot commands
    - build trigger comments
    - status commentary
    - duplicate explanations
    - generic boilerplate headings that add no requirements

    Keep:
    - concrete bug symptoms
    - user-visible impact
    - repro details
    - technical clues
    - explicit constraints
    - rollout or compatibility requirements if stated

    5. Optimize for autonomous execution
    - Do not write follow-up questions to the user.
    - When information is missing or ambiguous, record it as an unresolved detail in Open Questions for Research.
    - Phrase Open Questions for Research as statements, not as direct questions.
    - Prefer wording that tells the coding agent what is known, what is unknown, and what must be resolved by inspecting the codebase.

    6. Scope control
    - Keep the prompt atomic and tightly scoped to the ticket.
    - Use Subtasks only when the work clearly breaks into related pieces of the same ask.
    - If the ticket includes multiple unrelated asks, separate them into distinct subtasks only if they are clearly intended to ship together. Otherwise keep the dominant ask and note the rest under Open Questions.

    7. Acceptance criteria quality
    - Acceptance Criteria must be concise, observable, and checkable.
    - Prefer 2-5 bullets.
    - Derive only the minimum criteria directly implied by the ticket.
    - Do not add extra scenarios, defensive checks, or edge cases unless explicitly stated.

    OUTPUT FORMAT

    Always include these sections in this order:
    - Task
    - Expected Behavior
    - Acceptance Criteria
    - Open Questions for Research

    Include these sections only when the ticket supports them:
    - Current Behavior
    - Constraints
    - Subtasks
    - Implementation Hints
    - Assumptions

    SECTION INSTRUCTIONS

    ## Task
    One clear sentence describing the primary change.

    ## Current Behavior
    Only include for bugs, and only when the current broken behavior is stated or strongly evidenced in the ticket.

    ## Expected Behavior
    Describe the intended observable behavior after the change.
    If not explicitly stated, restate the requested outcome without adding scope.

    ## Acceptance Criteria
    Write 2-5 concise checklist items.
    Each item must be directly supported by the ticket or be a minimal restatement of the requested outcome.

    ## Constraints
    Only explicit constraints from the ticket.

    ## Subtasks
    Only include when the work naturally decomposes into related implementation steps.

    ## Implementation Hints
    Only actionable clues from the ticket.
    Label speculative clues clearly, for example:
    - Possible cause: ...
    - Possible location: ...

    ## Assumptions
    Only assumptions explicitly stated in the ticket.
    Do not create new assumptions.

    ## Open Questions for Research
    List unresolved details as short statements for codebase investigation.
    Do not phrase them as questions to the user.
    Use this section for ambiguity, missing scope boundaries, or missing expected behavior that cannot be safely inferred.

    FORMAT REQUIREMENTS
    - Output only the rewritten markdown prompt.
    - Keep wording concise and specific.
    - Do not include preamble or explanation.
    - Do not include empty bullets.
    - For required sections that truly cannot be populated, write: Not specified in ticket.
    - For Open Questions for Research, write: None. when no unresolved details remain.`;

    try {
      const config = this.configManager.getConfig();
      if (!config?.openaiApiKey) {
        throw new Error('OpenAI API key is required when prompt rewriting is enabled');
      }

      await this.ensureInitialized();
      if (!this.openai) throw new Error('OpenAI client not initialized');

      const response = await this.openai.chat.completions.create({
        model: 'gpt-5.2',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: ticket }
        ],
        max_tokens: 2000,
        temperature: 0.2
      });

      const content = response.choices[0]?.message?.content?.trim();
      if (!content) throw new Error('No rewritten prompt returned');
      return `${content}\n\n## Agent Instructions\nAnswer all open questions yourself using the codebase — do not ask the user. Make your best judgment based on available context and proceed with implementation. Prefer editing existing patterns over introducing new abstractions.`;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`Prompt rewrite failed: ${msg}`);
    }
  }

  async generatePullRequestDescription(taskDescription: string, diff: string, changedFiles: string[]): Promise<{ title: string; body: string }> {
    await this.ensureInitialized();

    // Truncate diff if it's too large (keep under 30K characters for the prompt)
    // This leaves room for the response and other parts of the prompt
    const MAX_DIFF_LENGTH = 30000;
    let truncatedDiff = diff;
    let diffWasTruncated = false;

    if (diff.length > MAX_DIFF_LENGTH) {
      // Take first and last portions of the diff to show context
      const firstPart = diff.substring(0, MAX_DIFF_LENGTH / 2);
      const lastPart = diff.substring(diff.length - MAX_DIFF_LENGTH / 2);
      truncatedDiff = `${firstPart}\n\n... (diff truncated - ${diff.length} total characters) ...\n\n${lastPart}`;
      diffWasTruncated = true;
    }

    const prompt = `
Generate a pull request title and description for the following task and changes.

Task: ${taskDescription}

Changed files:
${changedFiles.map(file => `- ${file}`).join('\n')}

Git diff${diffWasTruncated ? ' (truncated for brevity)' : ''}:
\`\`\`
${truncatedDiff}
\`\`\`

Generate:
1. A concise PR title (MUST be under 250 characters to fit GitHub's 256 character limit)
2. A concise PR description (MUST be under 10000 characters) with:
   - Brief summary of changes (2-3 sentences)
   - List of main changes (bullet points)
   - Any important notes

Keep the description focused and concise. Do NOT include the full diff in the description.`;

    try {
      if (!this.openai) {
        throw new Error('OpenAI client not initialized');
      }
      const response = await this.openai.chat.completions.create({
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
        max_tokens: 1000,
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

      // Ensure the PR body doesn't exceed GitHub's limit (65536 characters)
      // Leave some room for the attribution footer that GitManager will add
      const MAX_BODY_LENGTH = 65000;
      let body = parsed.body || `Implemented: ${taskDescription}\n\n🤖 Generated with Ivan`;

      if (body.length > MAX_BODY_LENGTH) {
        body = body.substring(0, MAX_BODY_LENGTH) + '\n\n... (description truncated)';
      }

      return {
        title,
        body
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
