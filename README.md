# Ivan 🤖

Your AI-Powered Development Assistant that automates complex development workflows by breaking down high-level requests into executable tasks, implementing them with AI assistance, and creating pull requests with properly formatted commits and descriptions.

## Installation

```bash
npm i -g @ariso-ai/ivan
```

On first run, Ivan will prompt you to configure API keys and preferences. You can reconfigure at any time with `ivan reconfigure`.

## Quick Start

### Running Tasks

Execute tasks directly in your repository:

```bash
# Interactive mode - Ivan will prompt you for what to build
ivan

# Or provide a task description directly
ivan "Add user authentication with JWT tokens"
```

Ivan will:
1. Break down your request into manageable tasks
2. Create branches and implement changes using AI
3. Generate proper commit messages
4. Create pull requests with detailed descriptions

### Addressing PR Comments

Automatically handle review comments on your pull requests:

```bash
# Scan all open PRs and address unresolved comments
ivan address

# Address comments on a specific PR
ivan address 123

# Only process comments from specific reviewers
ivan address --from-user username
```

Ivan will:
1. Find all unaddressed inline code comments
2. Implement fixes using AI
3. Commit changes with co-author attribution
4. Reply to comments with the fixing commit

### Automated GitHub Actions Workflow

Set up Ivan to automatically respond when tagged in GitHub issues:

```bash
# Add the Ivan Agent workflow to your repository
ivan add-action
```

This creates a GitHub Actions workflow that:
1. Triggers when someone mentions `@ivan-agent` in an issue
2. Reads the issue description as the task
3. Creates a PR with the implementation
4. Waits 15 minutes for reviews
5. Automatically addresses any review comments

**Required GitHub Secrets** (set in your repository settings under Settings → Secrets and variables → Actions):
- `OPEN_AI_KEY`: Your OpenAI API key
- `ANTHROPIC_KEY`: Your Anthropic API key
- `PAT`: GitHub Personal Access Token with `repo` and `pull_requests` permissions

## Understanding Ivan's Drivers

Ivan offers flexibility in how it authenticates and executes tasks through different driver options.

### Claude Execution Drivers

Choose how Ivan runs Claude Code to implement your tasks:

#### SDK Mode (Default - Recommended)
- **How it works**: Uses the Anthropic API directly via TypeScript SDK
- **Requires**: Anthropic API key (`sk-ant-...`)
- **Best for**: Users with API access, production environments
- **Advantages**: Reliable, works in CI/CD, better error handling

#### CLI Mode
- **How it works**: Uses the Claude Code CLI installed on your machine
- **Requires**: Claude Code CLI installed locally
- **Best for**: Claude Max subscribers (no API key needed)
- **Advantages**: Real-time streaming output, no API costs for Max subscribers

**Switch between modes:**
```bash
ivan configure-executor
```

### GitHub Authentication Drivers

Choose how Ivan authenticates with GitHub:

#### GitHub CLI (Default - Recommended)
- **How it works**: Uses `gh auth login` for authentication
- **Requires**: GitHub CLI installed and authenticated
- **Best for**: Local development, interactive use
- **Advantages**: Easy setup, secure token management

**Setup:**
```bash
gh auth login
```

#### Personal Access Token (PAT)
- **How it works**: Uses a manually created GitHub token
- **Requires**: GitHub PAT with `repo` and `pull_requests` permissions
- **Best for**: CI/CD environments, GitHub Actions, automated workflows
- **Advantages**: Works in non-interactive environments

**Create a PAT:** Go to GitHub Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token

**Configure:**
```bash
ivan reconfigure  # Select PAT option during setup
```

## Key Features

- **🧠 Intelligent Task Breakdown**: Analyzes your request and automatically breaks it down into manageable, PR-ready tasks
- **🤖 Flexible Claude Execution**: Choose between SDK (API-based) or CLI (Claude Max) execution modes
- **🔐 Flexible GitHub Auth**: Use GitHub CLI or Personal Access Tokens for authentication
- **🔄 Automated Git Workflow**: Creates branches, commits changes, and opens pull requests automatically
- **📝 Smart Commit Messages**: Generates conventional commit messages using OpenAI's GPT-4
- **💬 PR Comment Handling**: Automatically addresses PR review comments with `ivan address` command
- **🔍 Smart Review Requests**: Generates context-specific review instructions for each PR using AI
- **🤖 GitHub Actions Integration**: Trigger Ivan automatically when tagged in issues
- **🎯 Repository-Specific Instructions**: Set coding guidelines and patterns that are automatically applied to every task
- **📊 Progress Tracking**: SQLite database tracks all jobs, tasks, execution history, and tool calls
- **🌐 Web Interface**: Built-in web server to view and monitor jobs and tasks in your browser
- **⚡ Interactive Prompting**: Automatically prompts for missing configuration instead of failing

## Configuration

Ivan automatically prompts for configuration on first use. Configuration is stored in `~/.ivan/config.json` and the database in `~/.ivan/db.sqlite`.

### Reconfigure at Any Time

```bash
# Reconfigure all settings
ivan reconfigure

# Configure specific settings
ivan configure-executor        # Change Claude execution mode (SDK vs CLI)
ivan choose-model              # Select Claude model
ivan configure-review-agent    # Set review bot to tag in PRs
ivan show-config              # View current configuration
```

### Configuration Options

- **GitHub Authentication**: GitHub CLI (`gh`) or Personal Access Token (PAT)
- **Claude Executor Type**: SDK (API-based) or CLI (Claude Max)
- **OpenAI API Key**: For generating commit messages and PR descriptions
- **Anthropic API Key**: For Claude Code execution (SDK mode only)
- **Claude Model**: Choose between Sonnet 4.5, Haiku, or Opus
- **Repository Instructions**: Optional coding guidelines specific to each repository
- **Tool Permissions**: Configure which tools Claude Code can use per repository

## Usage Examples

### Interactive Mode

```bash
# Start Ivan in any git repository
ivan
```

Ivan will prompt you for what to build, then:
1. Break down your request into individual tasks
2. Ask if you want to wait for PR reviews
3. Execute each task using Claude Code
4. Create pull requests with detailed descriptions
5. Optionally wait and automatically address comments

### Non-Interactive Mode (Headless)

```bash
# Provide task description as an argument
ivan "Add user authentication with JWT tokens"

# Skip the review waiting prompt
ivan "Refactor the database module" --no-wait

# Wait for PR reviews after completion
ivan "Add comprehensive test coverage" --wait-for-reviews
```

Perfect for CI/CD pipelines, automated workflows, and scripting.

### Task Examples

Here are some example requests you can give Ivan:

- "Add user authentication with JWT tokens"
- "Refactor the database module to use TypeScript"
- "Add comprehensive test coverage for the API endpoints"
- "Implement a caching layer with Redis"
- "Fix all ESLint warnings and add proper error handling"

## CLI Commands Reference

### Main Commands

```bash
ivan                    # Run Ivan to execute tasks (default command)
ivan address [PR#]      # Address PR review comments (optionally specify PR number)
ivan reconfigure        # Reconfigure API keys and settings
ivan add-action         # Add Ivan Agent GitHub Action workflow to repository
```

### Configuration Commands

```bash
ivan configure-executor       # Choose Claude execution mode (SDK vs CLI)
ivan choose-model            # Select Claude model (Sonnet, Haiku, Opus)
ivan configure-review-agent  # Set review bot to tag in PRs
ivan show-config            # View current configuration
```

### Repository-Specific Configuration

```bash
ivan edit-repo-instructions  # Set coding guidelines for this repository
ivan config-tools           # Configure allowed tools for Claude Code
ivan config-blocked-tools   # Configure blocked tools for Claude Code
```

### Web Interface

```bash
ivan web [--port <port>]      # Start the web interface
ivan web-stop [--port <port>] # Stop the web interface
```

### Address Command Options

```bash
# Scan all open PRs for unaddressed comments
ivan address

# Address a specific PR
ivan address 123

# Only process comments from specific reviewers
ivan address --from-user username
ivan address --from-user user1 --from-user user2

# Skip confirmation prompts
ivan address --yes
```

The `--from-user` flag is useful for:
- Working with specific team members
- Prioritizing feedback from senior reviewers
- Processing comments in batches by reviewer

## Advanced Features

### Web Interface

Monitor jobs and tasks in your browser:

```bash
ivan web              # Start on port 3000
ivan web --port 8080  # Custom port
```

Open http://localhost:3000 to see:
- All jobs and their status
- Task progress and execution logs
- Pull request links

### Repository-Specific Instructions

Set coding guidelines automatically applied to every task:

```bash
ivan edit-repo-instructions
```

Examples:
- Coding style preferences (e.g., "Use TypeScript for all new files")
- Framework patterns (e.g., "Follow React hooks patterns")
- Testing requirements (e.g., "Add unit tests for new functions")
- Documentation standards

### Tool Configuration

Control which tools Claude Code can use:

```bash
ivan config-tools          # Configure allowed tools
ivan config-blocked-tools  # Configure blocked tools
```

Default: All tools allowed. Restrict for security: `["Bash", "Read", "Write", "Edit"]`

### Model Selection

```bash
ivan choose-model
```

Available models:
- **Claude Sonnet 4.5**: Recommended for most tasks (default)
- **Claude 3.5 Haiku**: Faster, good for simpler tasks
- **Claude Opus 4.1**: Most capable, but slower

## How It Works

### Standard Workflow
1. **Task Analysis**: Breaks your request into PR-ready tasks
2. **Branch Creation**: Creates a new branch for each task
3. **Code Implementation**: Implements changes using Claude Code
4. **Smart Commits**: Generates conventional commit messages
5. **Pull Request**: Creates PR with detailed description and review instructions
6. **Review Monitoring** (optional): Waits and automatically addresses comments
7. **Cleanup**: Returns to main branch and syncs

### Address Workflow
1. **PR Scanning**: Finds open PRs with unaddressed comments
2. **Comment Detection**: Uses GitHub GraphQL API to find unresolved comments
3. **Automated Fixes**: Implements fixes using Claude Code
4. **Smart Replies**: Replies to comments with the fixing commit
5. **Review Requests**: Adds context-specific review instructions

### GitHub Actions Workflow (via `ivan add-action`)
1. **Trigger**: Someone mentions `@ivan-agent` in an issue
2. **Task Execution**: Reads issue body and runs `ivan` command
3. **PR Creation**: Creates PR with implementation
4. **Wait Period**: Waits 15 minutes for reviews
5. **Auto-Address**: Runs `ivan address` to handle comments
6. **Status Updates**: Comments on the issue with progress

## Architecture

```
ivan/
├── src/
│   ├── database/       # SQLite schema and migrations
│   ├── services/       # Core services
│   │   ├── claude-executor.ts       # Claude Code SDK integration
│   │   ├── claude-cli-executor.ts   # Claude Code CLI integration
│   │   ├── executor-factory.ts      # Executor selection logic
│   │   ├── openai-service.ts        # OpenAI API for commits/PRs
│   │   ├── job-manager.ts           # Job and task management
│   │   ├── git-manager.ts           # Git operations (supports gh CLI and PAT)
│   │   ├── task-executor.ts         # Main workflow orchestration
│   │   ├── address-executor.ts      # PR comment addressing workflow
│   │   ├── address-task-executor.ts # Individual comment fix execution
│   │   └── pr-service.ts            # PR comment and check detection
│   ├── config.ts       # Configuration management (drivers, auth, etc.)
│   ├── web-server.ts   # Web interface server
│   └── index.ts        # CLI entry point
├── .github/workflows/
│   └── ivanagent.yml   # GitHub Actions workflow template
├── dist/               # Compiled JavaScript
└── ~/.ivan/            # User configuration and database
    ├── config.json     # API keys and settings
    │                   #   - executorType: "sdk" | "cli"
    │                   #   - githubAuthType: "gh-cli" | "pat"
    │                   #   - githubPat: optional PAT token
    └── db.sqlite       # Jobs and tasks database
```

## Database Schema

Ivan maintains a local SQLite database to track:
- **Jobs**: High-level user requests with timestamps and status
- **Tasks**: Individual tasks within a job, including:
  - Task description
  - Task type (build or address)
  - Execution status (not_started, active, completed)
  - Branch name tracking
  - Pull request links
  - Execution logs with tool calls
  - Timestamps

## Running Locally

```bash
# Clone the repository
git clone https://github.com/ariso-ai/ivan.git
cd ivan

# Install dependencies
npm install

# Build the project
npm run build

# Link globally for system-wide access
npm link

# Or run directly from the project directory
node dist/index.js
```

## Development

```bash
# Run in development mode
npm run dev

# Watch mode for development
npm run watch

# Run linter
npm run lint

# Type checking
npm run typecheck
```

## Advanced Features

### Execution Logs and Tracking
- All Claude Code interactions logged with tool calls
- Visual dividers separate responses for readability
- Tool inputs/outputs captured for debugging
- Logs stored in database per task
- Web interface for viewing progress

### Smart Review Comments
- AI-generated review instructions for each PR
- Uses GPT-4o-mini to analyze diffs and generate contextual requests
- Replies to comments include "Ivan:" prefix for attribution
- Co-author attribution in commits

### Comment Detection
- GitHub GraphQL API for resolved status detection
- Processes only unresolved inline code comments
- Ignores top-level PR comments
- Skips comments with existing replies

## Security Considerations

- **API Keys**: Stored locally in `~/.ivan/config.json` (not in database)
- **Input Masking**: All API key prompts are masked during entry
- **Local Execution**: Tasks run in your local environment with your credentials
- **GitHub Auth**: Supports both GitHub CLI and PAT authentication
- **Repository Secrets**: For GitHub Actions, secrets are managed through GitHub's secure secrets storage
- **Tool Permissions**: Configure allowed/blocked tools per repository for enhanced security

## Limitations

- **GitHub Only**: Currently supports GitHub repositories (GitLab/Bitbucket planned)
- **Task Complexity**: Tasks must be completable by Claude Code
- **Internet Required**: Active connection needed for AI services
- **GitHub Authentication**: Requires either GitHub CLI or PAT with appropriate permissions

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT

## Support

For issues, questions, or suggestions, please open an issue on GitHub.

## Troubleshooting

### GitHub Authentication Issues

**GitHub CLI not authenticated:**
```bash
gh auth login
```

**Using PAT instead of GitHub CLI:**
```bash
ivan reconfigure
# Select "Personal Access Token (PAT)" option
```

**PAT not working:**
- Verify PAT has `repo` and `pull_requests` permissions
- Check PAT hasn't expired
- Ensure PAT starts with `ghp_` or `github_pat_`

### Claude Execution Issues

**API keys not working:**
```bash
ivan reconfigure
```

**Claude CLI not found (CLI mode):**
```bash
# Install Claude Code CLI first
# See: https://docs.anthropic.com/claude/docs/claude-code

# Then configure Ivan to use CLI mode
ivan configure-executor
```

**Executor hanging (CLI mode):**
- Update Claude Code CLI to latest version
- Try SDK mode: `ivan configure-executor`
- Test `claude --print` works independently

**Anthropic API rate limits:**
- Switch to CLI mode if you have Claude Max: `ivan configure-executor`
- Wait for rate limit to reset
- Consider upgrading your API plan

### Driver Configuration

**Switch between GitHub CLI and PAT:**
```bash
ivan reconfigure
# Or edit ~/.ivan/config.json and set githubAuthType: "gh-cli" or "pat"
```

**Switch between SDK and CLI mode:**
```bash
ivan configure-executor
# Or view current settings with:
ivan show-config
```

### Other Issues

**Permission denied errors:**
- Ensure you have write access to the repository
- Check SSH keys are configured: `ssh -T git@github.com`
- If using PAT, verify token permissions

**Web server issues:**
- Check if port is in use: `lsof -i :3000`
- Try different port: `ivan web --port 8080`

**GitHub Actions workflow not triggering:**
- Verify secrets are set in repository settings
- Check workflow file exists at `.github/workflows/ivanagent.yml`
- Ensure PAT has correct permissions
- Review Actions tab for error logs

---

Built with ❤️ to make AI-powered development workflows more efficient and automated.