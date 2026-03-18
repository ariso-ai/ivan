#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ivan_entry="$script_dir/../../dist/index.js"

payload="$(mktemp)"
trap 'rm -f "$payload"' EXIT
cat > "$payload"

project_dir="${CLAUDE_PROJECT_DIR:-$(jq -r '.cwd // empty' "$payload")}"
if [[ -z "$project_dir" ]]; then
  exit 0
fi
log_dir="$project_dir/.claude/hooks/logs"
mkdir -p "$log_dir"
cp "$payload" "$log_dir/user-prompt-submit.$(date +%s).json"

repo="$(jq -r '.cwd // empty' "$payload")"
prompt="$(jq -r '.prompt // empty' "$payload")"

if [[ -z "$repo" || -z "$prompt" ]]; then
  exit 0
fi

output="$(node "$ivan_entry" learnings query --repo "$repo" --text "$prompt" --limit 3 2>>"$log_dir/query.stderr")" || true

if [[ -z "$output" || "$output" == *"No learnings matched that query."* ]]; then
  exit 0
fi

printf 'Local learnings relevant to this prompt:\n%s\n' "$output"
