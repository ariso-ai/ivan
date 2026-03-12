# How to install Claude Code hooks for automatic learnings surfacing

This guide shows you how to wire the ivan learnings system into Claude Code so that relevant learnings appear automatically—before each prompt, after each file edit, and at session end.

## What the hooks do

| Hook event | Script | Behaviour |
|---|---|---|
| `UserPromptSubmit` | `ivan-learnings-user-prompt.sh` | Queries learnings using the prompt text and prints matching results before Claude replies |
| `PostToolUse` (Edit/Write/MultiEdit) | `ivan-learnings-post-edit.sh` | Queries learnings after each file edit and prints any matching results |
| `Stop` | `ivan-learnings-stop.sh` | Surfaces a "final turn summary" query when the session ends |

## Prerequisites

- The learnings store must already be initialised (`ivan learnings init --repo .`)
- At least one PR ingested so there are learnings to surface

## Install the hooks

From your project root:

```bash
ivan learnings install-hooks --repo .
```

This writes three bash scripts into `.claude/hooks/` and merges the hook entries into `.claude/settings.json`. The command is idempotent—running it again updates the scripts without duplicating entries.

Expected output:

```
✅ Claude Code hook integration installed
Installed hooks: UserPromptSubmit, PostToolUse(Edit|Write|MultiEdit), Stop
Settings file: /path/to/your-project/.claude/settings.json
Hook scripts:
  - /path/to/your-project/.claude/hooks/ivan-learnings-user-prompt.sh
  - /path/to/your-project/.claude/hooks/ivan-learnings-post-edit.sh
  - /path/to/your-project/.claude/hooks/ivan-learnings-stop.sh
Updated .claude/settings.json with Ivan learnings hooks
```

## Verify the installation

Open `.claude/settings.json` and confirm entries like these exist:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "bash .../ivan-learnings-user-prompt.sh", "timeout": 10 }] }
    ],
    "PostToolUse": [
      { "matcher": "Edit|Write|MultiEdit", "hooks": [{ ... }] }
    ],
    "Stop": [
      { "hooks": [{ ... }] }
    ]
  }
}
```

## If hooks do not fire

Check the log files written by each script:

```bash
ls .claude/hooks/logs/
```

Errors from the query command are written to `.claude/hooks/logs/query.stderr`.

## Uninstall

Remove the three entries from `.claude/settings.json` and delete the scripts from `.claude/hooks/`.
