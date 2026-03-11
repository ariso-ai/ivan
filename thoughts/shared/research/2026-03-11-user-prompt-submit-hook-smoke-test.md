# UserPromptSubmit Hook Smoke Test

## Goal

Test one narrow hypothesis in total isolation:

- a `UserPromptSubmit` hook can inject plain text into Claude's context for a real Claude Code CLI session

This test does not use Ivan learnings, GitHub, SQLite, or any live repo data.

It uses a disposable repo and a hook that emits only:

- `HOOK_SMOKE_TEST: foo`
- or `HOOK_SMOKE_TEST: bar`

## Important Expectation

This hook should be treated as injecting extra context, not literally rewriting the user's raw prompt text.

The behavior we expect is:

1. user submits a prompt
2. `UserPromptSubmit` fires
3. hook stdout is added to Claude's context
4. Claude can see and respond to that injected marker

If this works, then the stronger learnings-hook experiment is worth testing next.

## Recommended Incremental Hook Set After This Smoke Test

Once this isolated test passes, use exactly these hook points for the real integration:

1. `UserPromptSubmit`
2. `PostToolUse(Edit|Write|MultiEdit)`
3. `Stop`

Why this set:

- `UserPromptSubmit` is the per-user-turn retrieval point.
- `PostToolUse(Edit|Write|MultiEdit)` is the highest-signal incremental point during implementation.
- `Stop` is the final per-response consolidation point.
- `PreToolUse` is intentionally excluded because it increases hook volume without adding enough new information for the integration we want.

## Test Shape

Use:

- direct `claude -p ...`
- a disposable git repo
- a repo-local `.claude/settings.json`
- one shell hook script

Do not use:

- Ivan
- SDK mode
- any retrieval command
- any stubbed "fake query" layer beyond the hook's own fixed `foo`/`bar` output

## Pass Criteria

- the hook runs on every submitted prompt
- the hook writes a copy of the real JSON payload to `/tmp`
- Claude's answer reflects the injected `HOOK_SMOKE_TEST: foo|bar` marker
- disabling the hook removes that behavior

## Step 1: Create A Disposable Repo

```bash
export TEST_REPO="$(mktemp -d /tmp/claude-user-prompt-hook-smoke-XXXXXX)"
git init "$TEST_REPO"
mkdir -p "$TEST_REPO/.claude/hooks"
cd "$TEST_REPO"
pwd
```

## Step 2: Create The Minimal Hook

This is intentionally small. It does two things:

- stores the real incoming hook payload under `/tmp`
- prints either `foo` or `bar`

```bash
cat > "$TEST_REPO/.claude/hooks/user-prompt-foo-bar.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

payload_file="/tmp/claude-user-prompt-submit.$(date +%s).json"
cat > "$payload_file"

if (( RANDOM % 2 )); then
  printf 'HOOK_SMOKE_TEST: foo\n'
else
  printf 'HOOK_SMOKE_TEST: bar\n'
fi
EOF

chmod +x "$TEST_REPO/.claude/hooks/user-prompt-foo-bar.sh"
```

If you want deterministic output instead of random output, replace the `if (( RANDOM % 2 ))` block with:

```bash
printf 'HOOK_SMOKE_TEST: foo\n'
```

## Step 3: Register The Hook

```bash
cat > "$TEST_REPO/.claude/settings.json" <<EOF
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash \"$TEST_REPO/.claude/hooks/user-prompt-foo-bar.sh\"",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
EOF
```

## Step 4: Run The Positive-Control Prompt

Run Claude directly from the disposable repo:

```bash
cd "$TEST_REPO"
claude -p "If you received any HOOK_SMOKE_TEST marker in your context, repeat it verbatim. If not, say no marker was provided." --permission-mode bypassPermissions | tee /tmp/claude-user-prompt-hook-smoke.out
```

## Step 5: Verify The Hook Actually Fired

Check that the payload file was written:

```bash
ls -1t /tmp/claude-user-prompt-submit.*.json | head
latest_payload="$(ls -1t /tmp/claude-user-prompt-submit.*.json | head -n 1)"
echo "$latest_payload"
sed -n '1,120p' "$latest_payload"
```

Expected:

- the payload file exists
- it contains real hook JSON
- it includes fields like `session_id`, `hook_event_name`, `cwd`, and `prompt`

## Step 6: Verify Claude Saw The Marker

Look at Claude's response:

```bash
sed -n '1,120p' /tmp/claude-user-prompt-hook-smoke.out
```

Pass condition:

- Claude repeats either `HOOK_SMOKE_TEST: foo` or `HOOK_SMOKE_TEST: bar`

If Claude does not mention the marker but the payload file exists, the hook likely ran but its stdout was not merged into context the way we expected.

## Step 7: Negative Control

Disable the hook by moving the settings file:

```bash
mv "$TEST_REPO/.claude/settings.json" "$TEST_REPO/.claude/settings.disabled.json"
```

Run the same prompt again:

```bash
cd "$TEST_REPO"
claude -p "If you received any HOOK_SMOKE_TEST marker in your context, repeat it verbatim. If not, say no marker was provided." --permission-mode bypassPermissions | tee /tmp/claude-user-prompt-hook-smoke.nohook.out
```

Expected:

- Claude should now say no marker was provided, or otherwise fail to mention `HOOK_SMOKE_TEST`

This confirms the earlier behavior came from the hook rather than prompt leakage or coincidence.

## Optional Step 8: Test Whether It Looks Like Appended Context

Run a prompt that asks Claude to distinguish user text from hook text:

```bash
mv "$TEST_REPO/.claude/settings.disabled.json" "$TEST_REPO/.claude/settings.json"

claude -p "Tell me exactly what the user asked, and separately tell me whether any extra HOOK_SMOKE_TEST context was provided." --permission-mode bypassPermissions | tee /tmp/claude-user-prompt-hook-separation.out
```

What we want to learn:

- whether Claude experiences the hook output as separate extra context rather than as a literal mutation of the user's message

## Interpreting Outcomes

### Case 1: Payload file exists and Claude repeats the marker

Interpretation:

- `UserPromptSubmit` is firing
- hook stdout is reaching Claude context
- the simple hypothesis is supported

### Case 2: Payload file exists but Claude does not mention the marker

Interpretation:

- the hook is firing
- the stdout-to-context assumption may be wrong, suppressed, or weaker than expected
- inspect whether Claude ignores short/inert text unless explicitly asked to surface it

### Case 3: No payload file exists

Interpretation:

- the hook is not firing at all
- the problem is hook registration, Claude settings discovery, or the execution path

## Troubleshooting

### Check settings file is in the repo Claude is running from

```bash
cd "$TEST_REPO"
pwd
sed -n '1,120p' .claude/settings.json
```

### Test the hook manually

```bash
echo '{"session_id":"test","hook_event_name":"UserPromptSubmit","cwd":"'"$TEST_REPO"'","prompt":"hello"}' | \
  bash "$TEST_REPO/.claude/hooks/user-prompt-foo-bar.sh"
```

Expected:

- prints `HOOK_SMOKE_TEST: foo` or `HOOK_SMOKE_TEST: bar`
- writes a payload file under `/tmp`

### Make output deterministic

If randomness is making verification annoying, hard-code `foo` instead of using `RANDOM`.

## Cleanup

```bash
rm -rf "$TEST_REPO"
rm -f /tmp/claude-user-prompt-submit.*.json
rm -f /tmp/claude-user-prompt-hook-smoke.out
rm -f /tmp/claude-user-prompt-hook-smoke.nohook.out
rm -f /tmp/claude-user-prompt-hook-separation.out
```

## Next Step If This Passes

If this smoke test passes, move to the stronger experiment:

- replace the fixed `foo`/`bar` output with a real local command
- for example, `node dist/index.js learnings query --repo ... --text "$prompt"`
- keep the same disposable-hook structure, logging, and negative controls
