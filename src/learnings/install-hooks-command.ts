import chalk from 'chalk';
import fs from 'fs';
import path from 'path';

interface InstallHooksCommandOptions {
  repo: string;
}

interface ClaudeHookCommandConfig {
  type: 'command';
  command: string;
  timeout: number;
}

interface ClaudeHookMatcherConfig {
  matcher?: string;
  hooks: ClaudeHookCommandConfig[];
}

interface ClaudeSettingsFile {
  hooks?: Record<string, ClaudeHookMatcherConfig[]>;
  [key: string]: unknown;
}

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
  const stopScriptPath = path.join(hooksDir, 'ivan-learnings-stop.sh');

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
  fs.writeFileSync(
    stopScriptPath,
    buildStopScript(nodeExecutable, ivanEntry),
    'utf8'
  );

  fs.chmodSync(userPromptScriptPath, 0o755);
  fs.chmodSync(postEditScriptPath, 0o755);
  fs.chmodSync(stopScriptPath, 0o755);

  const settingsPath = path.join(claudeDir, 'settings.json');
  const updatedSettings = upsertClaudeSettings(settingsPath, {
    userPromptScriptPath,
    postEditScriptPath,
    stopScriptPath
  });

  return {
    settingsPath,
    createdScripts: [userPromptScriptPath, postEditScriptPath, stopScriptPath],
    updatedSettings
  };
}

export async function runInstallHooksCommand(
  options: InstallHooksCommandOptions
): Promise<void> {
  const result = installLearningsHooks(options.repo);

  console.log(chalk.green('✅ Claude hook integration installed'));
  console.log(
    chalk.gray(
      'Installed hooks: UserPromptSubmit, PostToolUse(Edit|Write|MultiEdit), Stop'
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

function upsertClaudeSettings(
  settingsPath: string,
  scriptPaths: {
    userPromptScriptPath: string;
    postEditScriptPath: string;
    stopScriptPath: string;
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
  const stopCommand = buildHookCommand(scriptPaths.stopScriptPath);

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
    ),
    Stop: upsertHookEntry(
      existingHooks.Stop ?? [],
      {
        hooks: [{ type: 'command', command: stopCommand, timeout: 10 }]
      },
      ['ivan-learnings-stop.sh']
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

function buildHookCommand(scriptPath: string): string {
  return `bash ${shellQuote(scriptPath)}`;
}

function buildUserPromptScript(
  nodeExecutable: string,
  ivanEntry: string
): string {
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

function buildPostEditScript(
  nodeExecutable: string,
  ivanEntry: string
): string {
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

function buildStopScript(nodeExecutable: string, ivanEntry: string): string {
  return `#!/usr/bin/env bash
set -euo pipefail

node_bin=${shellQuote(nodeExecutable)}
ivan_entry=${shellQuote(ivanEntry)}

payload="$(mktemp)"
cat > "$payload"

project_dir="\${CLAUDE_PROJECT_DIR:-$(jq -r '.cwd // empty' "$payload")}"
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

printf 'Local learnings relevant at stop:\\n%s\\n' "$output"
`;
}

function resolveIvanEntryPoint(): string {
  const entryArg = process.argv[1];
  if (entryArg) {
    return path.resolve(entryArg);
  }

  return path.resolve(new URL('../index.js', import.meta.url).pathname);
}

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
