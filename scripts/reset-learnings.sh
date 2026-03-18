#!/usr/bin/env bash
set -euo pipefail

REPO="${1:-.}"

echo "Resetting learnings state for: $REPO"

rm -f "$REPO/.ivan/evidence.jsonl" \
       "$REPO/.ivan/lessons.jsonl" \
       "$REPO/.ivan/db.sqlite"

node "$(dirname "$0")/../dist/index.js" learnings init --repo "$REPO"

echo "Done."
