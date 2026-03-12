#!/usr/bin/env bash
set -euo pipefail

node_bin='/Users/michaelgeiger/.nvm/versions/node/v24.11.1/bin/node'
ivan_entry='/Users/michaelgeiger/Developer/repos/ivan.worktree/ivan-learnings/src/index.ts'

payload="$(mktemp)"
cat > "$payload"

project_dir="${CLAUDE_PROJECT_DIR:-$(jq -r '.cwd // empty' "$payload")}"
log_dir="$project_dir/.claude/hooks/logs"
mkdir -p "$log_dir"
cp "$payload" "$log_dir/post-tool-use.$(date +%s).json"

repo="$(jq -r '.cwd // empty' "$payload")"
tool_name="$(jq -r '.tool_name // empty' "$payload")"
tool_input="$(jq -c '.tool_input // {}' "$payload")"

if [[ -z "$repo" || -z "$tool_name" ]]; then
  exit 0
fi

query_text="recent file changes after tool: $tool_name; input: $tool_input"

if ! output="$("$node_bin" "$ivan_entry" learnings query --repo "$repo" --text "$query_text" --limit 3 2>>"$log_dir/query.stderr" || true)"; then
  exit 0
fi

if [[ -z "$output" || "$output" == *"No learnings matched that query."* ]]; then
  exit 0
fi

printf 'Local learnings relevant after edit:\n%s\n' "$output"
