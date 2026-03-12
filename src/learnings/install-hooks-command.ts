// CLI handler for `ivan learnings install-hooks`.
// Writes two bash scripts and wires them into `.claude/settings.json` so that
// learnings are surfaced automatically on each prompt submission and tool use.

import chalk from 'chalk';
import fs from 'fs';
import path from 'path';

interface InstallHooksCommandOptions {
  repo: string;
}

/** A single shell command registered as a Claude Code hook. */
interface ClaudeHookCommandConfig {
  type: 'command';
  command: string;
  timeout: number;
}

/** Groups hook commands under an optional tool-name matcher pattern. */
interface ClaudeHookMatcherConfig {
  matcher?: string;
  hooks: ClaudeHookCommandConfig[];
}

/** Partial representation of `.claude/settings.json` used for reading and merging hook configuration. */
interface ClaudeSettingsFile {
  hooks?: Record<string, ClaudeHookMatcherConfig[]>;
  [key: string]: unknown;
}

/**
 * Writes the two hook bash scripts, marks them executable, and upserts the hook entries
 * into `.claude/settings.json`.  Safe to re-run; existing scripts and settings are replaced.
 */
export function installLearningsHooks(repoPath: string): {
  settingsPath: string;
  createdScripts: string[];
  updatedSettings: boolean;
} {
  const resolvedRepoPath = path.resolve(repoPath);
  assertDirectoryExists(resolvedRepoPath);

  const claudeDir = path.join(resolvedRepoPath, '.claude');
  const hooksDir = path.join(claudeDir, 'hooks');
  const logsDir = path.join(hooksDir, 'logs');

  fs.mkdirSync(logsDir, { recursive: true });

  const nodeExecutable = process.execPath;
  const ivanEntry = resolveIvanEntryPoint();

  const userPromptScriptPath = path.join(
    hooksDir,
    'ivan-learnings-user-prompt.sh'
  );
  const postEditScriptPath = path.join(hooksDir, 'ivan-learnings-post-edit.sh');

  fs.writeFileSync(
    userPromptScriptPath,
    buildUserPromptScript(nodeExecutable, ivanEntry),
    'utf8'
  );
  fs.writeFileSync(
    postEditScriptPath,
    buildPostEditScript(nodeExecutable, ivanEntry),
    'utf8'
  );

  fs.chmodSync(userPromptScriptPath, 0o755);
  fs.chmodSync(postEditScriptPath, 0o755);

  const settingsPath = path.join(claudeDir, 'settings.json');
  const updatedSettings = upsertClaudeSettings(settingsPath, {
    userPromptScriptPath,
    postEditScriptPath
  });

  return {
    settingsPath,
    createdScripts: [userPromptScriptPath, postEditScriptPath],
    updatedSettings
  };
}

/** Commander action handler: calls `installLearningsHooks` and prints a formatted summary. */
export async function runInstallHooksCommand(
  options: InstallHooksCommandOptions
): Promise<void> {
  const result = installLearningsHooks(options.repo);

  console.log(chalk.green('✅ Claude hook integration installed'));
  console.log(
    chalk.gray(
      'Installed hooks: UserPromptSubmit, PostToolUse(Edit|Write|MultiEdit)'
    )
  );
  console.log(chalk.gray(`Settings file: ${result.settingsPath}`));
  console.log(chalk.gray('Hook scripts:'));
  for (const scriptPath of result.createdScripts) {
    console.log(chalk.gray(`  - ${scriptPath}`));
  }
  console.log(
    chalk.gray(
      result.updatedSettings
        ? 'Updated .claude/settings.json with Ivan learnings hooks'
        : '.claude/settings.json already matched the Ivan learnings hooks'
    )
  );
}

/**
 * Reads `.claude/settings.json`, merges the two hook entries (replacing any existing
 * ivan-learnings hooks by script name), and writes the file only if the content changed.
 * Returns true when the file was written.
 */
function upsertClaudeSettings(
  settingsPath: string,
  scriptPaths: {
    userPromptScriptPath: string;
    postEditScriptPath: string;
  }
): boolean {
  const existingSettings = readClaudeSettings(settingsPath);
  const existingHooks = existingSettings.hooks ?? {};
  const nextSettings: ClaudeSettingsFile = {
    ...existingSettings,
    hooks: { ...existingHooks }
  };

  const userPromptCommand = buildHookCommand(scriptPaths.userPromptScriptPath);
  const postEditCommand = buildHookCommand(scriptPaths.postEditScriptPath);

  nextSettings.hooks = {
    ...existingHooks,
    UserPromptSubmit: upsertHookEntry(
      existingHooks.UserPromptSubmit ?? [],
      {
        hooks: [{ type: 'command', command: userPromptCommand, timeout: 10 }]
      },
      ['ivan-learnings-user-prompt.sh']
    ),
    PostToolUse: upsertHookEntry(
      existingHooks.PostToolUse ?? [],
      {
        matcher: 'Edit|Write|MultiEdit',
        hooks: [{ type: 'command', command: postEditCommand, timeout: 10 }]
      },
      ['ivan-learnings-post-edit.sh']
    )
  };

  const previous = JSON.stringify(existingSettings, null, 2);
  const next = `${JSON.stringify(nextSettings, null, 2)}\n`;

  if (previous === next.trimEnd()) {
    return false;
  }

  fs.writeFileSync(settingsPath, next, 'utf8');
  return true;
}

/**
 * Removes any existing hook entries whose command contains one of `scriptNameMarkers`,
 * then appends `nextEntry`.  This ensures exactly one ivan-learnings entry per hook type.
 */
function upsertHookEntry(
  existingEntries: ClaudeHookMatcherConfig[],
  nextEntry: ClaudeHookMatcherConfig,
  scriptNameMarkers: string[]
): ClaudeHookMatcherConfig[] {
  const filtered = existingEntries.filter(
    (entry) =>
      !entry.hooks.some((hook) =>
        scriptNameMarkers.some((marker) => hook.command.includes(marker))
      )
  );

  filtered.push(nextEntry);
  return filtered;
}

/** Reads and parses `.claude/settings.json`; returns an empty object if the file is absent or empty. */
function readClaudeSettings(settingsPath: string): ClaudeSettingsFile {
  if (!fs.existsSync(settingsPath)) {
    return {};
  }

  const raw = fs.readFileSync(settingsPath, 'utf8').trim();
  if (!raw) {
    return {};
  }

  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Expected ${settingsPath} to contain a JSON object`);
  }

  return parsed as ClaudeSettingsFile;
}

/** Wraps a script path in a `bash <path>` invocation string for the Claude settings JSON. */
function buildHookCommand(scriptPath: string): string {
  return `bash ${shellQuote(scriptPath)}`;
}

/** Generates the `UserPromptSubmit` hook script that queries learnings using the user's prompt text. */
function buildUserPromptScript(nodeExecutable: string, ivanEntry: string): string {
  return `#!/usr/bin/env bash
set -euo pipefail

node_bin=${shellQuote(nodeExecutable)}
ivan_entry=${shellQuote(ivanEntry)}

payload="$(mktemp)"
cat > "$payload"

project_dir="\${CLAUDE_PROJECT_DIR:-$(jq -r '.cwd // empty' "$payload")}"
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

printf 'Local learnings relevant to this prompt:\\n%s\\n' "$output"
`;
}

/** Generates the `PostToolUse` hook script that queries learnings after each Edit/Write/MultiEdit tool call. */
function buildPostEditScript(nodeExecutable: string, ivanEntry: string): string {
  return `#!/usr/bin/env bash
set -euo pipefail

node_bin=${shellQuote(nodeExecutable)}
ivan_entry=${shellQuote(ivanEntry)}

payload="$(mktemp)"
cat > "$payload"

project_dir="\${CLAUDE_PROJECT_DIR:-$(jq -r '.cwd // empty' "$payload")}"
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

printf 'Local learnings relevant after edit:\\n%s\\n' "$output"
`;
}

/** Returns the absolute path to the ivan CLI entry point by reading `process.argv[1]` or falling back to `import.meta.url`. */
function resolveIvanEntryPoint(): string {
  const entryArg = process.argv[1];
  if (entryArg) {
    return path.resolve(entryArg);
  }

  return path.resolve(new URL('../index.js', import.meta.url).pathname);
}

/** Single-quote-escapes a string for safe embedding in a bash script. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function assertDirectoryExists(repoPath: string): void {
  if (!fs.existsSync(repoPath)) {
    throw new Error(`Repository path does not exist: ${repoPath}`);
  }

  if (!fs.statSync(repoPath).isDirectory()) {
    throw new Error(`Repository path is not a directory: ${repoPath}`);
  }
}
