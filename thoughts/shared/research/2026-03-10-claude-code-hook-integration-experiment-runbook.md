# Claude Code Hook Integration Experiment Runbook

## Purpose

Validate how Claude Code hooks actually behave with Ivan's current learnings MVP.

This runbook is intentionally about integration mechanics, not ranking quality:

- Does a real `UserPromptSubmit` hook fire in the environments we care about?
- Does `PostToolUse(Edit|Write|MultiEdit)` fire after real file mutations?
- Does `Stop` fire once per response cycle?
- Can those hooks call the real `ivan learnings query` command against a real repo-local `learnings.db`?
- Do those hooks inject local learnings into Claude's context without using canned output or stub data?
- Does the behavior differ between:
  - direct Claude Code CLI usage
  - Ivan running in Claude CLI mode
  - Ivan running in SDK mode

## Chosen Incremental Hook Set

Document the runtime surface as exactly:

1. `UserPromptSubmit`
2. `PostToolUse(Edit|Write|MultiEdit)`
3. `Stop`

Reasoning:

- `UserPromptSubmit` gives one retrieval point per user turn before Claude reasons.
- `PostToolUse(Edit|Write|MultiEdit)` gives one retrieval point after each successful file mutation, which is the highest-signal incremental update during implementation.
- `Stop` gives one final dedupe or summary point at the end of the response cycle.
- `PreToolUse` is intentionally excluded because it roughly doubles edit-hook volume without adding enough new information for the learnings MVP.
- `SessionStart` and `SessionEnd` are useful for lifecycle logging, but they are not part of the recommended incremental retrieval surface.

## What This Experiment Does Not Test

- Automatic GitHub evidence ingestion
- Quality of the learning extraction heuristics
- Whether the retrieved learning is "the best" one
- Any future hook integration that is not yet implemented in Ivan itself

## Real-Data Rule

Do not use fake hook output.

- The hook script must not `echo` hard-coded learnings.
- The hook script must only emit output that comes from a real `ivan learnings query --repo ... --text ...` call.
- Seed the test repo with at least one real learning derived from an actual repo fact, merged PR, commit, ADR, or review discussion.

## Assumptions Under Test

1. Claude Code `UserPromptSubmit` hooks fire for real CLI sessions.
2. The hook payload includes enough information to run Ivan locally:
   - `cwd`
   - `prompt`
   - `session_id`
3. Hook stdout is added to Claude's context before Claude answers.
4. `ivan learnings query` uses only local `learnings.db` data and does not require live GitHub access.
5. Ivan in Claude CLI mode inherits the same hook behavior because it shells out to the `claude` binary.
6. Ivan in SDK mode does not trigger local Claude CLI hooks, because it uses the Anthropic SDK directly instead of spawning the CLI.
7. A failing hook should fail open for this experiment: log the error, emit no context, and let Claude continue.

## Why These Assumptions Are Plausible

- Ivan's CLI executor shells out to `claude` with the repo as `cwd` in [`src/services/claude-cli-executor.ts`](../../../src/services/claude-cli-executor.ts).
- Ivan's SDK executor uses `query(...)` from the Anthropic SDK in [`src/services/claude-executor.ts`](../../../src/services/claude-executor.ts), which is a different path from invoking the local `claude` binary.
- Ivan's learnings surface is currently local-only:
  - `ivan learnings init --repo ...`
  - `ivan learnings rebuild --repo ...`
  - `ivan learnings query --repo ... --text ...`

## Prerequisites

- Claude Code CLI installed and authenticated
- `node`, `npm`, and `jq` installed
- This Ivan checkout built locally
- A real git repository to test against
- Permission to create a temporary `.claude/` directory in that repo

## Recommended Test Target

Use this repo itself first:

`/Users/michaelgeiger/Developer/repos/ivan.worktree/ivan-learnings`

Reason:

- the learnings commands already exist here
- the repo already contains real development history and PR references
- you can seed one real learning from an actual Ivan change instead of inventing data

## Step 1: Build Ivan From This Checkout

```bash
cd /Users/michaelgeiger/Developer/repos/ivan.worktree/ivan-learnings
npm run build
export IVAN_BIN="$PWD/dist/index.js"
```

Sanity check:

```bash
node "$IVAN_BIN" --help | sed -n '1,80p'
node "$IVAN_BIN" learnings --help
```

## Step 2: Initialize Learnings In The Test Repo

Set the target repo:

```bash
export TEST_REPO="/Users/michaelgeiger/Developer/repos/ivan.worktree/ivan-learnings"
cd "$TEST_REPO"
node "$IVAN_BIN" learnings init --repo "$TEST_REPO"
```

Capture the generated repository id:

```bash
export REPO_ID="$(basename "$TEST_REPO"/learnings/repositories/*.yaml .yaml)"
echo "$REPO_ID"
```

## Step 3: Seed One Real Learning

Use one real repository fact, not placeholder text.

Recommended real example for this repo:

- source: Ivan PR #15 prompt-routing work
- real takeaway: Claude CLI prompts must be passed with `-p` before greedy flags like `--disallowed-tools`, or the prompt can be swallowed during CLI parsing

Create one evidence record:

```bash
export NOW="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

cat > "$TEST_REPO/learnings/evidence/$REPO_ID/ev_real_pr15_prompt_parsing.md" <<EOF
---
id: ev_real_pr15_prompt_parsing
repository_id: $REPO_ID
source_system: github
source_type: pr_review_summary
external_id: pr_15
url: https://github.com/ariso-ai/ivan/pull/15
pr_number: 15
author_type: human
author_name: repository_history
author_role: maintainer
title: Prompt must be passed with -p before greedy CLI flags
base_weight: 6
final_weight: 10
boosts:
  - merged_change
penalties: []
created_at: $NOW
updated_at: $NOW
---
PR #15 established that the Claude CLI prompt must be passed with \`-p\` before greedy multi-value flags like \`--disallowed-tools\`, otherwise the prompt can be consumed by argument parsing instead of being treated as the prompt input.
EOF
```

Create one learning record linked to that evidence:

```bash
cat > "$TEST_REPO/learnings/lessons/$REPO_ID/lrn_real_pr15_prompt_parsing.md" <<EOF
---
id: lrn_real_pr15_prompt_parsing
repository_id: $REPO_ID
kind: repo_convention
source_type: github_pr_discourse
title: Put Claude CLI prompt first
confidence: 0.92
status: active
evidence_ids:
  - ev_real_pr15_prompt_parsing
tags:
  - claude-cli
  - prompt-routing
  - command-line
created_at: $NOW
updated_at: $NOW
---
## Statement
Pass the Claude CLI prompt with \`-p\` before greedy multi-value flags like \`--disallowed-tools\`.

## Rationale
If the prompt is placed after greedy flags, CLI parsing can consume it and Claude will not receive the intended task text.

## Applicability
Use this for any Ivan code path that shells out to the \`claude\` binary.
EOF
```

Rebuild and verify:

```bash
node "$IVAN_BIN" learnings rebuild --repo "$TEST_REPO"
node "$IVAN_BIN" learnings query --repo "$TEST_REPO" --text "disallowed tools prompt parsing" --limit 3
```

Expected result:

- at least one learning is returned
- the output includes the `lrn_real_pr15_prompt_parsing` learning
- the evidence URL points to a real repo artifact, not a placeholder

## Step 4: Install A Real Hook That Only Calls Ivan

Create a repo-local Claude hook directory:

```bash
mkdir -p "$TEST_REPO/.claude/hooks/logs"
```

Create a shared hook log directory:

```bash
cat > "$TEST_REPO/.claude/hooks/ensure-log-dir.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
log_dir="${CLAUDE_PROJECT_DIR:-$PWD}/.claude/hooks/logs"
mkdir -p "$log_dir"
EOF
chmod +x "$TEST_REPO/.claude/hooks/ensure-log-dir.sh"
```

Create the real `UserPromptSubmit` integration hook:

```bash
cat > "$TEST_REPO/.claude/hooks/ivan-learnings-user-prompt.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

payload="$(mktemp)"
cat > "$payload"

project_dir="${CLAUDE_PROJECT_DIR:-$(jq -r '.cwd // empty' "$payload")}"
log_dir="$project_dir/.claude/hooks/logs"
mkdir -p "$log_dir"
cp "$payload" "$log_dir/user-prompt-submit.$(date +%s).json"

repo="$(jq -r '.cwd // empty' "$payload")"
prompt="$(jq -r '.prompt // empty' "$payload")"

if [[ -z "$repo" || -z "$prompt" ]]; then
  exit 0
fi

ivan_bin="${IVAN_BIN:?Set IVAN_BIN before running the experiment}"

if ! output="$(node "$ivan_bin" learnings query --repo "$repo" --text "$prompt" --limit 3 2>>"$log_dir/query.stderr" || true)"; then
  exit 0
fi

if [[ -z "$output" ]]; then
  exit 0
fi

if [[ "$output" == *"No learnings matched that query."* ]]; then
  exit 0
fi

printf 'Local learnings relevant to this prompt:\n%s\n' "$output"
EOF
chmod +x "$TEST_REPO/.claude/hooks/ivan-learnings-user-prompt.sh"
```

Create a `PostToolUse(Edit|Write|MultiEdit)` hook that only reacts to real file mutations:

```bash
cat > "$TEST_REPO/.claude/hooks/ivan-learnings-post-edit.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

payload="$(mktemp)"
cat > "$payload"

project_dir="${CLAUDE_PROJECT_DIR:-$(jq -r '.cwd // empty' "$payload")}"
log_dir="$project_dir/.claude/hooks/logs"
mkdir -p "$log_dir"
cp "$payload" "$log_dir/post-tool-use.$(date +%s).json"

repo="$(jq -r '.cwd // empty' "$payload")"
tool_name="$(jq -r '.tool_name // empty' "$payload")"

if [[ -z "$repo" || -z "$tool_name" ]]; then
  exit 0
fi

ivan_bin="${IVAN_BIN:?Set IVAN_BIN before running the experiment}"
query_text="recent file changes after tool: $tool_name"

if ! output="$(node "$ivan_bin" learnings query --repo "$repo" --text "$query_text" --limit 3 2>>"$log_dir/query.stderr" || true)"; then
  exit 0
fi

if [[ -z "$output" || "$output" == *"No learnings matched that query."* ]]; then
  exit 0
fi

printf 'Local learnings relevant after edit:\n%s\n' "$output"
EOF
chmod +x "$TEST_REPO/.claude/hooks/ivan-learnings-post-edit.sh"
```

Create a `Stop` hook for final-turn aggregation:

```bash
cat > "$TEST_REPO/.claude/hooks/ivan-learnings-stop.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

payload="$(mktemp)"
cat > "$payload"

project_dir="${CLAUDE_PROJECT_DIR:-$(jq -r '.cwd // empty' "$payload")}"
log_dir="$project_dir/.claude/hooks/logs"
mkdir -p "$log_dir"
cp "$payload" "$log_dir/stop.$(date +%s).json"

repo="$(jq -r '.cwd // empty' "$payload")"

if [[ -z "$repo" ]]; then
  exit 0
fi

ivan_bin="${IVAN_BIN:?Set IVAN_BIN before running the experiment}"

if ! output="$(node "$ivan_bin" learnings query --repo "$repo" --text "final turn summary" --limit 3 2>>"$log_dir/query.stderr" || true)"; then
  exit 0
fi

if [[ -z "$output" || "$output" == *"No learnings matched that query."* ]]; then
  exit 0
fi

printf 'Local learnings relevant at stop:\n%s\n' "$output"
EOF
chmod +x "$TEST_REPO/.claude/hooks/ivan-learnings-stop.sh"
```

Create a minimal repo-local Claude settings file for the experiment:

```bash
cat > "$TEST_REPO/.claude/settings.json" <<'EOF'
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash \"$CLAUDE_PROJECT_DIR/.claude/hooks/ivan-learnings-user-prompt.sh\"",
            "timeout": 10
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "bash \"$CLAUDE_PROJECT_DIR/.claude/hooks/ivan-learnings-post-edit.sh\"",
            "timeout": 10
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash \"$CLAUDE_PROJECT_DIR/.claude/hooks/ivan-learnings-stop.sh\"",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
EOF
```

## Step 5: Positive Control With Direct Claude CLI

Run Claude directly from the test repo:

```bash
cd "$TEST_REPO"
claude -p "What do I need to know about prompt parsing and disallowed tools in this repo?" --permission-mode bypassPermissions | tee /tmp/claude-hook-positive.txt
```

Verify:

```bash
ls -la "$TEST_REPO/.claude/hooks/logs"
tail -n 20 "$TEST_REPO/.claude/hooks/logs/query.stderr" 2>/dev/null || true
```

Pass criteria:

- a `user-prompt-submit.*.json` log exists
- Claude's answer references the real local learning about `-p` / `--disallowed-tools`
- the hook output came from `ivan learnings query`, not from a hard-coded echo

## Step 5A: Edit Hook Positive Control

Ask Claude to make a small real edit in the repo, then inspect the logs:

```bash
cd "$TEST_REPO"
claude -p "Add one harmless comment to a temporary file in this repo, then tell me what you changed." --permission-mode bypassPermissions | tee /tmp/claude-hook-post-edit.txt
ls -1 "$TEST_REPO/.claude/hooks/logs"/post-tool-use.*.json | tail
```

Pass criteria:

- at least one `post-tool-use.*.json` log exists
- the payload shows `tool_name` equal to `Edit`, `Write`, or `MultiEdit`
- Claude still answers normally after the post-edit hook runs

## Step 5B: Stop Hook Positive Control

Inspect the stop-hook logs from the same session:

```bash
ls -1 "$TEST_REPO/.claude/hooks/logs"/stop.*.json | tail
```

Pass criteria:

- at least one `stop.*.json` log exists
- the hook runs once per response cycle rather than once per tool call

## Step 6: Negative Control With An Unrelated Prompt

```bash
cd "$TEST_REPO"
claude -p "Give me a high-level summary of the README web server feature." --permission-mode bypassPermissions | tee /tmp/claude-hook-negative.txt
```

Pass criteria:

- the hook still fires and logs the prompt
- `ivan learnings query` returns no match or no relevant match
- Claude does not invent the prompt-routing learning when it is unrelated

## Step 7: Prove Query Path Is Local-Only

First, prove the learnings command works without GitHub auth:

```bash
cd "$TEST_REPO"
env -u GH_TOKEN -u GITHUB_TOKEN node "$IVAN_BIN" learnings query --repo "$TEST_REPO" --text "disallowed tools prompt parsing" --limit 3
```

If feasible on your machine, briefly disable network and repeat the same command. Do not disable network for the Claude CLI tests unless you already know Claude can authenticate/call the model path another way.

Pass criteria:

- the query still returns the same learning without GitHub credentials
- the hook's useful behavior depends on local `learnings.db`, not live GitHub calls

## Step 8: Test Ivan In Claude CLI Mode

Snapshot your current Ivan config first:

```bash
cp ~/.ivan/config.json /tmp/ivan-config.backup.json
```

Switch Ivan to CLI executor:

```bash
jq '.executorType = "cli"' ~/.ivan/config.json > /tmp/ivan-config.cli.json
mv /tmp/ivan-config.cli.json ~/.ivan/config.json
```

Run Ivan against the same repo with a prompt that should hit the learning:

```bash
cd "$TEST_REPO"
node "$IVAN_BIN" "Fix the Claude prompt parsing so disallowed tools do not swallow the prompt"
```

Pass criteria:

- new `user-prompt-submit.*.json` logs appear during Ivan execution
- the same learning shows up in Claude's reasoning/output path
- this demonstrates that Ivan's CLI executor preserves Claude CLI hook behavior

## Step 9: Negative Control With Ivan SDK Mode

Switch Ivan to SDK mode:

```bash
jq '.executorType = "sdk"' ~/.ivan/config.json > /tmp/ivan-config.sdk.json
mv /tmp/ivan-config.sdk.json ~/.ivan/config.json
```

Count the current hook logs:

```bash
before_count="$(find "$TEST_REPO/.claude/hooks/logs" -name 'user-prompt-submit.*.json' | wc -l | tr -d ' ')"
echo "$before_count"
```

Run the same Ivan task again:

```bash
cd "$TEST_REPO"
node "$IVAN_BIN" "Fix the Claude prompt parsing so disallowed tools do not swallow the prompt"
```

Count again:

```bash
after_count="$(find "$TEST_REPO/.claude/hooks/logs" -name 'user-prompt-submit.*.json' | wc -l | tr -d ' ')"
echo "$after_count"
```

Expected result:

- `after_count` should equal `before_count`
- that indicates the local Claude CLI hook did not fire for the SDK execution path
- if the count increases anyway, the assumption is wrong and the SDK path needs separate investigation

## Step 10: Failure-Mode Test

Temporarily remove the derived DB:

```bash
mv "$TEST_REPO/learnings.db" "$TEST_REPO/learnings.db.bak"
```

Run the direct Claude CLI prompt again:

```bash
cd "$TEST_REPO"
claude -p "What do I need to know about prompt parsing and disallowed tools in this repo?" --permission-mode bypassPermissions | tee /tmp/claude-hook-fail-open.txt
```

Pass criteria:

- Claude still answers
- the hook logs an error in `.claude/hooks/logs/query.stderr`
- the hook does not inject fake fallback text

Restore the DB:

```bash
mv "$TEST_REPO/learnings.db.bak" "$TEST_REPO/learnings.db"
```

## Results Table

Record the outcome explicitly:

| Assumption | Evidence | Pass/Fail | Notes |
| --- | --- | --- | --- |
| Direct Claude CLI fires `UserPromptSubmit` | `.claude/hooks/logs/user-prompt-submit.*.json` exists |  |  |
| Direct Claude CLI fires `PostToolUse(Edit|Write|MultiEdit)` | `.claude/hooks/logs/post-tool-use.*.json` exists after a real edit |  |  |
| Direct Claude CLI fires `Stop` | `.claude/hooks/logs/stop.*.json` exists after a completed response |  |  |
| Hook receives usable `cwd` and `prompt` | logged payload contains both fields |  |  |
| Hook output reaches Claude context | Claude answer reflects seeded learning |  |  |
| Query path is local-only | `ivan learnings query` works with GitHub auth unset |  |  |
| Ivan CLI mode preserves hook behavior | new hook logs appear during `ivan` run in CLI mode |  |  |
| Ivan SDK mode does not use CLI hooks | hook log count does not increase in SDK mode |  |  |
| Hook fails open | missing DB logs error but Claude still answers |  |  |

## Cleanup

Restore Ivan config:

```bash
mv /tmp/ivan-config.backup.json ~/.ivan/config.json
```

Remove experiment hooks if this was a disposable setup:

```bash
rm -rf "$TEST_REPO/.claude"
```

If you do not want to keep the seeded records:

```bash
rm -rf "$TEST_REPO/learnings" "$TEST_REPO/learnings.db"
git checkout -- "$TEST_REPO/.gitignore" 2>/dev/null || true
```

## Interpreting Outcomes

- If direct Claude CLI works but Ivan CLI mode does not, Ivan's CLI executor is interfering with repo-local Claude hook discovery.
- If both direct Claude CLI and Ivan CLI mode work, the integration path is viable for the selected three-hook learnings recall surface.
- If SDK mode also fires the hook, our assumption about SDK isolation is wrong and we need to document exactly how that happens.
- If the hook fires but Claude ignores the injected output, the next experiment should isolate Claude's actual context merge behavior rather than the hook shelling behavior.
