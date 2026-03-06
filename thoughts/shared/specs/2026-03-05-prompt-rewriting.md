# Prompt Rewriting Feature Specification

## Executive Summary

Add a `--rewrite-prompt` CLI flag to Ivan that transforms verbose GitHub issues (typically created by Ari) into optimized, structured prompts for coding agents. The feature uses OpenAI gpt-4o-mini to rewrite prompts, informed by code context from the target repository.

## Problem Statement

When Ari creates GitHub issues and passes them to Ivan, the prompts contain significant noise:
- Slack metadata (channel IDs, reporter info, "@max requested...")
- Assignee directives ("Please assign to @ivan-agent")
- Build triggers ("@ivan-agent /build")
- Speculative "Codebase Context" sections ("I searched but didn't find...")
- Generic "Implementation Notes" boilerplate ("This issue was created by Ari...")
- Duplicate explanations (problem stated multiple times)

This noise wastes tokens and can confuse the coding agent. Research shows "most agent failures aren't model failures anymore, they're context failures" (Addy Osmani, 2026).

## Success Criteria

- Prompts are 40-60% shorter while retaining all actionable information
- Claude Code execution success rate improves (measurable via task completion)
- Developers can review both original and rewritten prompts in the database
- No increase in task execution time (rewriting adds <5 seconds)

## User Personas

**Primary: Ari (AI Agent)**
- Creates verbose GitHub issues from Slack conversations
- Passes issues to Ivan via GitHub Actions workflow
- Needs issues distilled to what matters for implementation

**Secondary: Human Developers**
- May use `--rewrite-prompt` for their own verbose task descriptions
- Want to see what was rewritten and why

## User Journey

1. Ari creates GitHub issue with verbose description
2. GitHub Actions workflow triggers with `ivan -c config.json --rewrite-prompt`
3. Ivan extracts task description from issue
4. **Step 1 - Extract Questions**: LLM reads ticket, outputs objective research questions (no solutioning)
5. **Step 2 - Objective Research**: Fresh LLM call with ONLY the questions (ticket excluded), searches codebase, returns factual findings
6. **Step 3 - Rewrite**: LLM receives original ticket + objective research, produces structured prompt
7. Both original and rewritten versions stored in task table
8. Rewritten prompt passed to Claude Code
9. Task executes with cleaner, better-informed context

## Functional Requirements

### Must Have (P0)

- **CLI flag `--rewrite-prompt`**
  - When enabled, triggers prompt rewriting before task execution
  - Works with both interactive and non-interactive modes
  - Acceptance: `ivan "verbose task" --rewrite-prompt` rewrites before execution

- **Code context gathering**
  - Searches target repository for files matching keywords in the prompt
  - Collects file contents up to 32K token limit
  - Falls back to file tree if no matches found
  - Acceptance: Keywords "publicGraph" and "MCP servers" find relevant files

- **OpenAI-powered rewriting**
  - Uses gpt-4o-mini via existing OpenAI service
  - Receives original prompt + code context
  - Returns structured markdown format
  - Acceptance: Verbose 2000-word issue becomes ~500-word structured prompt

- **Database storage**
  - New columns: `original_description`, `rewritten_description`
  - Existing `description` column contains the version used for execution
  - Migration preserves existing data
  - Acceptance: Query task shows both original and rewritten versions

- **Structured output format**
  ```markdown
  ## Task
  [Clear, specific statement of what to implement/fix]

  ## Current Behavior
  [Only if bug fix - what happens now]

  ## Expected Behavior
  [What should happen after implementation]

  ## Relevant Files
  [Discovered via code lookup or parsed from issue]

  ## Acceptance Criteria
  - [ ] Criterion 1
  - [ ] Criterion 2

  ## Constraints
  [Technical constraints mentioned]
  ```

### Should Have (P1)

- **Noise removal patterns**
  - Strip Slack metadata (channel IDs, "Reported by:", "Requested by:")
  - Remove assignee directives ("@ivan-agent /build", "Please assign to")
  - Remove generic "Implementation Notes" boilerplate
  - Deduplicate repeated explanations
  - Acceptance: None of these patterns appear in rewritten output

- **Reference extraction**
  - Parse file paths mentioned in the issue (e.g., "in listeners.ts")
  - Parse function/class names mentioned
  - Include these in "Relevant Files" section
  - Acceptance: `publicGraph.invoke()` mentioned in issue appears in output

### Nice to Have (P2)

- **Dry-run mode**
  - `--rewrite-prompt --dry-run` shows rewritten prompt without executing
  - Useful for debugging/tuning the rewriter

- **Token statistics**
  - Log original vs rewritten token counts
  - Track compression ratio over time

## Technical Architecture

### Data Model

```sql
-- Migration: Add columns to tasks table
ALTER TABLE tasks ADD COLUMN original_description TEXT;
ALTER TABLE tasks ADD COLUMN rewritten_description TEXT;
-- Existing description column holds the version used for execution
```

### System Components — 3-Step Pipeline (12 Factor Agents inspired)

**Key principle**: Each step runs in a fresh LLM context with a single goal.
Deterministic code controls the pipeline; LLMs only do the thinking.

```
┌─────────────────┐
│   CLI Input     │ --rewrite-prompt flag
└────────┬────────┘
         │
         v
┌─────────────────┐
│ Step 1: Extract │ LLM reads ticket → outputs research questions
│   Questions     │ Goal: "What do I need to know about the codebase?"
│                 │ NO solutioning, NO implementation plans
└────────┬────────┘
         │ questions only (ticket NOT passed forward)
         v
┌─────────────────┐
│ Step 2: Research│ Fresh LLM call with ONLY the questions
│  (Objective)    │ + code context gathered from repo (32K tokens)
│                 │ Returns: factual codebase findings
│                 │ The LLM does NOT know what the ticket is about
└────────┬────────┘
         │ research findings
         v
┌─────────────────┐
│ Step 3: Rewrite │ LLM receives: original ticket + research
│   Prompt        │ Produces: structured prompt for coding agent
│                 │ Informed by objective research, not speculation
└────────┬────────┘
         │
         v
┌─────────────────┐
│  TaskExecutor   │ Uses rewritten prompt for Claude
└─────────────────┘
```

**Why separate context windows?**
- Prevents "intent leakage" — when a model sees a ticket during research, it solutions instead of observing
- Each step has ONE goal, making each LLM call more reliable
- Research stays objective (model doesn't know what it's researching FOR)
- Mirrors the 12 Factor Agents principle: don't use prompts for control flow

### New Files

- `src/services/prompt-rewriter.ts` - Pipeline orchestrator (3-step flow)
- `src/services/code-context-gatherer.ts` - Repo search and context assembly
- `src/database/migrations/014_add_prompt_rewriting_columns.ts` - Schema migration

### Integration Points

- **OpenAI Service**: Add 3 methods: `extractResearchQuestions()`, `conductObjectiveResearch()`, `rewritePrompt()`
- **Task Executor**: Call rewriter pipeline before `executeTask()` when flag enabled
- **Job Manager**: Store both versions when creating task
- **Non-Interactive Config**: Add `rewritePrompt?: boolean` option

## Non-Functional Requirements

- **Performance**: Rewriting adds <5 seconds to task creation (OpenAI API call)
- **Reliability**: If OpenAI call fails, fall back to original prompt (don't block execution)
- **Token Budget**: Code context capped at 32K tokens (gpt-4o-mini has 128K context)
- **Observability**: Log rewriting decisions and token counts at debug level

## Out of Scope

- Fine-tuning a custom rewriting model
- Support for other LLMs (Anthropic, local models)
- Real-time streaming of rewriting progress
- UI for comparing original vs rewritten
- Rewriting PR comments (only task descriptions)

## Open Questions for Implementation

1. **Token counting**: Use tiktoken for accurate counts or approximate with characters/4?
2. **File matching**: Simple keyword grep or AST-based semantic matching?
3. **Caching**: Cache code context between tasks in same job?
4. **Rate limiting**: Handle OpenAI rate limits gracefully?

## Appendix: Research Findings

### Optimal Prompt Formats (2025-2026)

- **Structured sections with explicit boundaries** - Role, Goal, Constraints, Output format
- **Task decomposition** - Break complex issues into focused subtasks
- **Remove noise** - Strip metadata that doesn't help the agent
- **Context assembly is key** - "Most agent failures aren't model failures anymore, they're context failures"
- **File-level specificity** - Reference relevant files/patterns explicitly

### Sources

- [Prompt Engineering Best Practices 2026 | Thomas Wiegold](https://thomas-wiegold.com/blog/prompt-engineering-best-practices-2026/)
- [Optimizing Agentic Coding: How to Use Claude Code in 2026](https://aimultiple.com/agentic-coding)
- [MAGIS: LLM-Based Multi-Agent Framework for GitHub Issue Resolution](https://arxiv.org/pdf/2403.17927)
- [Palantir - Best practices for LLM prompt engineering](https://www.palantir.com/docs/foundry/aip/best-practices-prompt-engineering)
- [Addy Osmani - My LLM coding workflow going into 2026](https://medium.com/@addyosmani/my-llm-coding-workflow-going-into-2026-52fe1681325e)

### Example Transformation

**Before (verbose GitHub issue):**
```
Context from Slack #ari-reliability:

When a user clicks a magic link from SciSummary Slack to onboard Ari, if they are already logged into a different Ari account in the browser (e.g., Ariso org), the existing session persists
Result: they see an old/incorrect onboarding or profile page tied to the existing session instead of the intended workspace/account from the magic link
Current workaround: manually visit web.ari.ariso.ai/my/profile, log out, then re-click the Slack link
Impact:

Confusing initial experience, especially for users who belong to multiple orgs or have prior sessions
Makes it look like Ari is "stuck" or broken when connecting Slack
Expected behavior:

Clicking a magic link from Slack should either:
Establish a session for the intended account/workspace directly, OR
Explicitly prompt the user to switch accounts / confirm which workspace to use
Acceptance criteria:

Repro steps documented
Magic link flow updated so that clicking from Slack correctly associates the session with the intended account/workspace, regardless of prior session
Add tests for magic-link + existing-session behavior
From Slack: Max requested a build trigger comment once created: "@ivan-agent /build"
```

**After (rewritten):**
```markdown
## Task
Fix magic link authentication to handle existing sessions correctly

## Current Behavior
When user clicks Slack magic link while logged into different Ari account, existing session persists. User sees wrong onboarding/profile page instead of intended workspace.

## Expected Behavior
Magic link either:
1. Establishes session for intended workspace directly, OR
2. Prompts user to switch accounts/confirm workspace

## Relevant Files
- Authentication/session handling code
- Magic link route handler
- Onboarding flow components

## Acceptance Criteria
- [ ] Magic link works regardless of prior session state
- [ ] Multi-org users see correct workspace after clicking link
- [ ] Tests cover magic-link + existing-session scenarios

## Constraints
- Must not break existing magic link flow for new users
```
