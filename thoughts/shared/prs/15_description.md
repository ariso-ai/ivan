# PR #15 — Prompt Rewriting

## What does this PR do?

Adds an optional prompt rewriting step that runs before Claude Code executes a task. When enabled via `--rewrite-prompt`, a verbose development ticket (Slack threads, assignee metadata, boilerplate) is sent to GPT-4o-mini, which strips the noise and returns a clean, structured markdown prompt with sections for Task, Expected Behavior, Acceptance Criteria, Open Questions, etc. The rewritten prompt is what Claude Code actually receives. The original ticket is preserved in the database for reference.

Also fixes a long-standing bug where the task prompt could be silently consumed by `--disallowed-tools` during CLI argument parsing.

## Why?

Tickets that come in from Slack or project management tools are full of metadata that confuses coding agents — assignee directives, channel IDs, duplicate explanations, speculative context. Cleaning them up before execution improves the quality and specificity of Claude Code's output.

## Changes

### New feature: `--rewrite-prompt`

- `src/services/openai-service.ts` — `rewritePrompt()` method: calls GPT-4o-mini with a structured system prompt to strip noise and reformat the ticket. Appends a standard `## Agent Instructions` section telling Claude Code not to ask clarifying questions and to resolve open questions using the codebase.
- `src/services/prompt-rewriter.ts` — thin wrapper that calls `rewritePrompt()` and returns `{ original, rewritten }`.
- `src/types/non-interactive-config.ts` — adds `rewritePrompt?: boolean` field to config schema.
- `src/index.ts` — wires `--rewrite-prompt` as a registered Commander option and fixes CLI argument routing (see decision note below).
- `src/services/task-executor.ts` — applies rewriting in both `executeNonInteractiveWorkflow` and `executeWorkflow` before tasks are created/executed. Stores the original ticket in `original_description` when the description was rewritten.

### Database

- `src/database/migrations/014_add_original_description_column.ts` — adds a single `original_description TEXT` column to `tasks`. The existing `description` column holds whatever was sent to Claude (rewritten if rewriting ran; original otherwise).
- `src/database/types.ts` — adds `original_description: string | null` to the `Task` interface.
- `src/services/job-manager.ts` — adds `updateTaskOriginalDescription()`, initialises the new column to `null` in both insert paths.

### Bug fix: prompt delivery via `-p`

- `src/services/claude-cli-executor.ts` — the task description is now passed as the value of `-p` at the front of the args list, rather than as a trailing positional argument. This prevents `--disallowed-tools` (a greedy multi-value flag) from consuming the prompt during CLI argument parsing, which caused `Error: Input must be provided either through stdin or as a prompt argument when using --print`.

## How to test

```bash
# Rewrite a single task
ivan "Add a loading spinner to the submit button" --rewrite-prompt

# Via config file
echo '{"tasks":["your verbose ticket"],"rewritePrompt":true}' > /tmp/test.json
ivan -c /tmp/test.json

# Flag overrides config
ivan -c /tmp/config-without-flag.json --rewrite-prompt

# Interactive mode (previously crashed)
ivan --rewrite-prompt

# Verify DB storage after a run
sqlite3 ~/.ivan/db.sqlite \
  "SELECT substr(description,1,100), substr(original_description,1,100) FROM tasks ORDER BY id DESC LIMIT 1;"
# description = rewritten prompt, original_description = raw ticket
```

## What was removed / cleaned up

- `src/services/code-context-gatherer.ts` — deleted (dead code, never imported; was scaffolding for an unimplemented 3-step pipeline)
- `extractResearchQuestions()` in `openai-service.ts` — removed (same reason)
- `thoughts/shared/plans/` and `thoughts/shared/specs/` — planning artifacts removed from the branch
- `rewritten_description` column — dropped from migration and data model; the rewritten text lives in `description`, the original in `original_description`

## CLI routing decision: `program.parseOptions()` + operands

`index.ts` has a hybrid routing pattern: some paths (positional task, interactive mode) are handled manually before Commander ever runs, and others fall through to `program.parseAsync()`. Adding `--rewrite-prompt` exposed a flaw in this pattern — when a flag precedes the task description (e.g. `ivan --rewrite-prompt "task"`), the original code checked `args[0]` which was `--rewrite-prompt`, not the task, so routing fell through to Commander which rejected the task string as an unknown command.

**The fix:** Register `--rewrite-prompt` on `program` as a proper Commander option, then call `program.parseOptions(args)` early. This returns `operands` — the args with all known flags stripped — so the routing logic works regardless of where `--rewrite-prompt` appears in the command.

**Is this the right approach?** It's a pragmatic fix that works within the existing hybrid architecture. The cleaner long-term solution would be to register all of Ivan's entry points (positional task, `-c config`) as Commander commands/options too, and let Commander handle all routing uniformly. That's a larger refactor. For now, `parseOptions()` + operands is the minimal change that makes the hybrid pattern flag-order-independent without restructuring anything.

## Notes

- Rewriting is opt-in; all existing behaviour is unchanged when the flag is absent.
- If the OpenAI API key is not configured, `rewritePrompt()` now throws immediately with a clear error inside the `try` block rather than dropping into an interactive key prompt mid-run.
- GPT-4o-mini is used (fast, cheap). Temperature 0.2 for determinism.
- Tickets over 24,000 characters are truncated (first half + last half) before being sent.
