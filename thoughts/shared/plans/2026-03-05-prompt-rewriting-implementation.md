# Implementation Plan: Prompt Rewriting Feature

**Spec**: [2026-03-05-prompt-rewriting.md](../specs/2026-03-05-prompt-rewriting.md)
**Estimated Tasks**: 8
**Complexity**: Medium
**Architecture**: 3-step pipeline inspired by 12 Factor Agents (separate context windows, no intent leakage)

---

## Task 1: Database Migration

**Goal**: Add columns to store original and rewritten prompts

**Files to modify**:
- `src/database/migrations/014_add_prompt_rewriting_columns.ts` (create)
- `src/database/migrations/index.ts` (import new migration)
- `src/database/types.ts` (update Task interface)

**Changes**:
```typescript
export const migration014: Migration = {
  id: 14,
  name: 'add_prompt_rewriting_columns',
  up: [
    'ALTER TABLE tasks ADD COLUMN original_description TEXT',
    'ALTER TABLE tasks ADD COLUMN rewritten_description TEXT'
  ],
  down: [
    'ALTER TABLE tasks DROP COLUMN original_description',
    'ALTER TABLE tasks DROP COLUMN rewritten_description'
  ]
};
```

**Acceptance**: Migration runs without error, new columns visible in SQLite schema

---

## Task 2: Code Context Gatherer

**Goal**: Search target repository for relevant files based on research questions (NOT the ticket)

**Files to create**:
- `src/services/code-context-gatherer.ts`

**Implementation**:
```typescript
export class CodeContextGatherer {
  constructor(private workingDir: string) {}

  // Takes QUESTIONS, not the ticket - prevents intent leakage
  async gatherContext(questions: string[], maxTokens: number = 32000): Promise<string> {
    // 1. Extract search keywords from questions
    // 2. Search for matching files (glob + grep)
    // 3. Read file contents up to token limit
    // 4. Format as factual context string
  }

  private extractKeywords(questions: string[]): string[] {
    // Extract function names, file paths, class names from questions
  }

  private async searchFiles(keywords: string[]): Promise<string[]> {
    // Use glob and grep to find relevant files
  }

  private estimateTokens(text: string): number {
    // Approximate: chars / 4
  }
}
```

**Acceptance**: Given questions about "publicGraph.invoke()", finds files containing that string

---

## Task 3: Step 1 — Extract Research Questions

**Goal**: LLM reads ticket, outputs objective research questions. NO solutioning.

**Files to modify**:
- `src/services/openai-service.ts` (add `extractResearchQuestions()` method)

**Implementation**:
```typescript
async extractResearchQuestions(ticket: string): Promise<string[]> {
  const systemPrompt = `You are a research question extractor. Given a development ticket,
output a list of objective questions about the codebase that would need to be answered
before implementing this ticket.

RULES:
- Output ONLY questions, one per line
- Questions should be about WHAT EXISTS in the codebase, not HOW to implement
- Do NOT include implementation suggestions
- Do NOT include opinions or recommendations
- Focus on: file locations, function signatures, data flow, dependencies, test patterns
- Strip all metadata (who requested it, Slack channels, assignees)

Example good questions:
- "Where is the magic link route handler defined?"
- "What session management library/pattern is currently used?"
- "How does the existing authentication flow handle multiple accounts?"

Example BAD questions (these are implementation, not research):
- "Should we use middleware to clear sessions?"
- "What's the best way to handle account switching?"`;

  const response = await this.client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: ticket }
    ],
    temperature: 0.3
  });

  return response.choices[0].message.content
    .split('\n')
    .map(q => q.replace(/^[-*\d.]\s*/, '').trim())
    .filter(q => q.length > 0);
}
```

**Key design decision**: This is the ONLY step that sees the original ticket.
The questions it produces are the bridge to step 2, which never sees the ticket.

**Acceptance**: Given a verbose Ari ticket, outputs 5-10 objective research questions with zero implementation suggestions

---

## Task 4: Step 2 — Objective Research

**Goal**: Fresh LLM call with ONLY questions + code context. No ticket. Returns factual findings.

**Files to modify**:
- `src/services/openai-service.ts` (add `conductObjectiveResearch()` method)

**Implementation**:
```typescript
async conductObjectiveResearch(questions: string[], codeContext: string): Promise<string> {
  const systemPrompt = `You are a codebase researcher. You will be given research questions
and code context from a repository. Answer each question factually based ONLY on the code provided.

RULES:
- Answer ONLY what the code shows. Do not speculate.
- If the code context doesn't contain enough information, say "Not found in provided context"
- Do NOT suggest implementations or solutions
- Do NOT recommend approaches or patterns to use
- Report what EXISTS: file paths, function signatures, patterns, dependencies
- Be concise and factual

Format: Answer each question with a brief factual response.`;

  const questionsText = questions.map((q, i) => `${i + 1}. ${q}`).join('\n');

  const response = await this.client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Research Questions:\n${questionsText}\n\nCode Context:\n${codeContext}` }
    ],
    temperature: 0.2
  });

  return response.choices[0].message.content;
}
```

**Key design decision**: This step NEVER sees the original ticket.
It receives only the questions from step 1 and raw code context.
This prevents intent leakage — the model can't solution because it doesn't know the goal.

**Acceptance**: Given questions + code context, returns factual answers with no implementation suggestions

---

## Task 5: Step 3 — Rewrite Prompt

**Goal**: Combine original ticket + objective research into structured coding agent prompt

**Files to modify**:
- `src/services/openai-service.ts` (add `rewritePrompt()` method)

**Implementation**:
```typescript
async rewritePrompt(originalTicket: string, objectiveResearch: string): Promise<string> {
  const systemPrompt = `You are a prompt optimizer for coding agents. You will receive:
1. An original development ticket (often verbose, with noise)
2. Objective research about the relevant codebase

Produce a clean, structured prompt optimized for a coding agent (Claude Code).

OUTPUT FORMAT:
## Task
[Clear, specific statement of what to implement/fix]

## Current Behavior
[Only if bug fix - what happens now, concisely]

## Expected Behavior
[What should happen after implementation]

## Relevant Files
[From the research - actual file paths and functions found]

## Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2

## Constraints
[Technical constraints or patterns to follow, from research]

NOISE TO REMOVE:
- Slack metadata (channel IDs, "Reported by:", "Requested by:")
- Assignee directives ("@ivan-agent /build", "Please assign to")
- Generic boilerplate ("This issue was created by Ari...")
- Speculative codebase context ("I searched but didn't find...")
- Duplicate explanations

INFORMATION TO PRESERVE:
- The actual problem/feature description
- Acceptance criteria
- Technical constraints
- File paths and function names (verified by research)`;

  const response = await this.client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Original Ticket:\n${originalTicket}\n\nObjective Research:\n${objectiveResearch}` }
    ],
    temperature: 0.3
  });

  return response.choices[0].message.content;
}
```

**Key design decision**: This is the only step that sees BOTH the ticket and the research.
The research is objective (it was produced without knowing the ticket),
so the rewriter can now make informed decisions about what to keep/remove.

**Acceptance**: Verbose 2000-word issue becomes ~500-word structured prompt with verified file references

---

## Task 6: Pipeline Orchestrator

**Goal**: Wire the 3 steps together with deterministic control flow

**Files to create**:
- `src/services/prompt-rewriter.ts`

**Implementation**:
```typescript
export class PromptRewriter {
  private openaiService: OpenAIService;
  private contextGatherer: CodeContextGatherer;

  constructor(openaiService: OpenAIService, workingDir: string) {
    this.openaiService = openaiService;
    this.contextGatherer = new CodeContextGatherer(workingDir);
  }

  async rewrite(originalTicket: string): Promise<{ original: string; rewritten: string }> {
    // Step 1: Extract research questions (ticket → questions)
    console.log('Step 1/3: Extracting research questions...');
    const questions = await this.openaiService.extractResearchQuestions(originalTicket);

    // Step 2: Objective research (questions + code → findings)
    // NOTE: originalTicket is NOT passed here — preventing intent leakage
    console.log('Step 2/3: Conducting objective codebase research...');
    const codeContext = await this.contextGatherer.gatherContext(questions);
    const research = await this.openaiService.conductObjectiveResearch(questions, codeContext);

    // Step 3: Rewrite (ticket + research → structured prompt)
    console.log('Step 3/3: Rewriting prompt...');
    const rewritten = await this.openaiService.rewritePrompt(originalTicket, research);

    return { original: originalTicket, rewritten };
  }
}
```

**Key design decision**: This is deterministic code, not a prompt.
The pipeline order is fixed. Each LLM call has one goal.
No prompt controls the flow — code does.

**Acceptance**: Pipeline runs all 3 steps in order, ticket never leaks into step 2

---

## Task 7: CLI Flag + Task Executor Integration

**Goal**: Add `--rewrite-prompt` flag and wire into both interactive and non-interactive flows

**Files to modify**:
- `src/index.ts` (add commander flag)
- `src/types/non-interactive-config.ts` (add option)
- `src/services/task-executor.ts` (call pipeline before execution)
- `src/services/job-manager.ts` (store both versions)

**CLI changes**:
```typescript
// index.ts
program.option('--rewrite-prompt', 'Rewrite verbose prompts for coding agents')

// non-interactive-config.ts
export interface NonInteractiveConfig {
  // ... existing
  rewritePrompt?: boolean;
}
```

**Task executor changes**:
```typescript
private async maybeRewritePrompt(
  description: string,
  workingDir: string,
  shouldRewrite: boolean
): Promise<{ original: string; rewritten: string | null }> {
  if (!shouldRewrite) {
    return { original: description, rewritten: null };
  }

  try {
    const rewriter = new PromptRewriter(this.getOpenAIService(), workingDir);
    const result = await rewriter.rewrite(description);
    return result;
  } catch (error) {
    console.warn('Prompt rewriting failed, using original:', error);
    return { original: description, rewritten: null };
  }
}
```

**Acceptance**:
- `ivan --help` shows `--rewrite-prompt` option
- `ivan -c '{"tasks":["verbose task"], "rewritePrompt": true}'` runs 3-step pipeline
- Both versions stored in task table

---

## Task 8: Testing & Documentation

**Goal**: Ensure feature works end-to-end

**Test cases**:
1. `ivan "simple task"` - no rewriting (flag not set)
2. `ivan "simple task" --rewrite-prompt` - runs 3-step pipeline
3. Step 1 outputs only questions, no implementation suggestions
4. Step 2 never receives the original ticket
5. Step 3 produces structured output with verified file references
6. OpenAI API failure at any step - graceful fallback to original
7. No matching files in repo - step 2 still answers what it can

**Documentation to add to README**:
```markdown
### Prompt Rewriting

Optimize verbose prompts (like GitHub issues) for better Claude Code execution:

ivan "long verbose task description..." --rewrite-prompt

Ivan uses a 3-step pipeline:
1. Extracts objective research questions from the ticket
2. Researches the codebase WITHOUT seeing the ticket (prevents bias)
3. Rewrites the prompt using both the ticket and objective research
```

**Acceptance**: All test cases pass, documentation merged

---

## Execution Order

```
Task 1 (Migration) ─────────┐
                             │
Task 2 (Context Gatherer) ───┤
                             ├──> Task 6 (Pipeline) ──> Task 7 (CLI + Executor) ──> Task 8 (Testing)
Task 3 (Step 1: Questions) ──┤
                             │
Task 4 (Step 2: Research) ───┤
                             │
Task 5 (Step 3: Rewrite) ───┘
```

Tasks 1-5 can be parallelized. Task 6 composes them. Task 7 wires into Ivan. Task 8 is final.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| OpenAI API rate limits (3 calls per task) | Implement exponential backoff, fallback to original |
| Intent leakage in step 2 | Pipeline enforces ticket exclusion in code, not prompts |
| Rewriting makes prompt worse | Log all 3 steps (questions, research, rewrite) for debugging |
| Token counting inaccurate | Use conservative estimates, add 20% buffer |
| Large repos timeout on context gathering | Set timeout, limit file count |
| 3 API calls add latency | Steps 1-2 use gpt-4o-mini (fast); total ~5-10 seconds |
