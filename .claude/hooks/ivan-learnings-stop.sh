#!/usr/bin/env bash
set -euo pipefail

node_bin='/Users/michaelgeiger/.nvm/versions/node/v24.11.1/bin/node'
ivan_entry='/Users/michaelgeiger/Developer/repos/ivan.worktree/ivan-learnings/src/index.ts'

payload="$(mktemp)"
cat > "$payload"

project_dir="${CLAUDE_PROJECT_DIR:-$(jq -r '.cwd // empty' "$payload")}"
log_dir="$project_dir/.claude/hooks/logs"
mkdir -p "$log_dir"
cp "$payload" "$log_dir/stop.$(date +%s).json"

repo="$(jq -r '.cwd // empty' "$payload")"
stop_hook_active="$(jq -r '.hook_event_name // empty' "$payload")"

if [[ -z "$repo" || -z "$stop_hook_active" ]]; then
  exit 0
fi

if ! output="$("$node_bin" "$ivan_entry" learnings query --repo "$repo" --text "final turn summary" --limit 3 2>>"$log_dir/query.stderr" || true)"; then
  exit 0
fi

if [[ -z "$output" || "$output" == *"No learnings matched that query."* ]]; then
  exit 0
fi

printf 'Local learnings relevant at stop:\n%s\n' "$output"
