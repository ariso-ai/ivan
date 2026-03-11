#!/usr/bin/env bash
set -euo pipefail

node_bin='/Users/michaelgeiger/.nvm/versions/node/v24.11.1/bin/node'
ivan_entry='/Users/michaelgeiger/Developer/repos/ivan.worktree/ivan-learnings/src/index.ts'

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

if ! output="$("$node_bin" "$ivan_entry" learnings query --repo "$repo" --text "$prompt" --limit 3 2>>"$log_dir/query.stderr" || true)"; then
  exit 0
fi

if [[ -z "$output" || "$output" == *"No learnings matched that query."* ]]; then
  exit 0
fi

printf 'Local learnings relevant to this prompt:\n%s\n' "$output"
