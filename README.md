# Ivan 🤖

## Your AI-Powered Development Assistant

Ivan is an intelligent CLI tool that automates complex development workflows by breaking down high-level requests into executable tasks, implementing them with AI assistance, and creating pull requests with properly formatted commits and descriptions.

## Key Features

- **🧠 Intelligent Task Breakdown**: Analyzes your request and automatically breaks it down into manageable, PR-ready tasks
- **🤖 Claude Code Integration**: Leverages Anthropic's Claude Code SDK for advanced code generation and modification
- **🔄 Automated Git Workflow**: Creates branches, commits changes, and opens pull requests automatically
- **📝 Smart Commit Messages**: Generates conventional commit messages using OpenAI's GPT-4
- **💬 PR Comment Handling**: Automatically addresses PR review comments with `ivan address` command
- **🔍 Smart Review Requests**: Generates context-specific review instructions for each PR using AI
- **⏰ Optional Review Monitoring**: Can wait 30 minutes after task completion to automatically address incoming PR comments
- **🎯 Repository-Specific Instructions**: Set coding guidelines and patterns that are automatically applied to every task
- **📊 Progress Tracking**: SQLite database tracks all jobs, tasks, execution history, and tool calls
- **🌐 Web Interface**: Built-in web server to view and monitor jobs and tasks in your browser
- **⚡ Interactive Prompting**: Automatically prompts for missing configuration instead of failing

## Prerequisites

- Node.js 20+ 
- Git repository
- GitHub CLI (`gh`) installed and authenticated
- OpenAI API key (for commit messages and PR descriptions)
- Anthropic API key (for Claude Code execution)

## Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/ivan.git
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

## Configuration

Ivan will automatically prompt for configuration on first use. You can also reconfigure at any time:

```bash
# Reconfigure API keys and settings
ivan reconfigure
```

### Configuration includes:
- **OpenAI API Key**: For generating commit messages and PR descriptions
- **Anthropic API Key**: For Claude Code execution
- **Repository Instructions**: Optional coding guidelines specific to each repository
- **Tool Permissions**: Configure which tools Claude Code can use per repository

Configuration is stored in `~/.ivan/config.json` and the database in `~/.ivan/db.sqlite`

## Usage

### Running Tasks

Simply run `ivan` in any git repository:

```bash
ivan
```

Then describe what you want to accomplish. Ivan will:
1. Break down your request into individual tasks
2. Ask if you want to wait for PR reviews after completion
3. Execute each task using Claude Code
4. Create pull requests with proper commits and AI-generated review instructions
5. Optionally wait 30 minutes and automatically address any PR comments

### CLI Commands

#### Main Commands

```bash
# Run Ivan to execute tasks (default command)
ivan

# Reconfigure API keys and settings
ivan reconfigure

# Address PR review comments and failing checks
ivan address

# Start the web interface
ivan web [--port <port>]

# Stop the web interface
ivan web-stop [--port <port>]
```

#### Repository Configuration

```bash
# Set or update repository-specific instructions
ivan edit-repo-instructions

# Configure allowed tools for Claude Code in current repository
ivan config-tools

# Show current repository configuration
ivan show-config

# Choose which Claude model to use for tasks
ivan choose-model
```

### Addressing PR Comments

Automatically handle PR review comments:

```bash
# Scan all open PRs for unaddressed comments and failing checks
ivan address
```

This will:
1. Find all open PRs with unaddressed inline code comments
2. Let you select which PRs to address
3. Create tasks for each unaddressed comment
4. Automatically implement fixes using Claude Code
5. Commit changes with co-author attribution
6. Reply to each comment with the commit that fixed it
7. Add a review request with specific instructions

### Example Requests

- "Add user authentication with JWT tokens"
- "Refactor the database module to use TypeScript"
- "Add comprehensive test coverage for the API endpoints"
- "Implement a caching layer with Redis"
- "Fix all ESLint warnings and add proper error handling"

### Web Interface

Start the web server to monitor jobs and tasks:

```bash
# Start web server on default port 3000
ivan web

# Or specify a custom port
ivan web --port 8080

# Stop the web server
ivan web-stop
```

Then open http://localhost:3000 in your browser to see:
- All jobs and their status
- Individual task progress
- Execution logs
- Pull request links

### Repository-Specific Instructions

Set coding guidelines that will be automatically applied to every task:

```bash
# Set or update repository instructions
ivan edit-repo-instructions

# Instructions can include:
- Coding style preferences
- Framework-specific patterns
- Testing requirements
- Documentation standards
```

**Note**: Ivan will prompt for instructions the first time you use it in a repository. If you decline, it won't ask again, but you can always configure them later using `ivan edit-repo-instructions`.

### Tool Configuration

Control which tools Claude Code can use in your repository:

```bash
# Configure allowed tools
ivan config-tools

# View current configuration
ivan show-config
```

By default, all tools are allowed. You can restrict to specific tools like `["Bash", "Read", "Write", "Edit"]` for enhanced security.

### Model Selection

Choose which Claude model to use for task execution:

```bash
# Select a Claude model
ivan choose-model
```

Available models:
- **Claude 3.5 Sonnet (Latest)**: Default, balanced performance
- **Claude 3.5 Haiku (Latest)**: Faster, good for simpler tasks
- **Claude Opus 4.1**: Most capable, but slower

## How It Works

### Standard Workflow
1. **Task Analysis**: Claude Code analyzes your request and breaks it into PR-ready tasks
2. **Review Options**: Asks if you want to wait for PR reviews (optional)
3. **Branch Creation**: Creates a new branch for each task (`ivan/task-description-timestamp`)
4. **Code Implementation**: Claude Code implements the changes using your repository context
5. **Smart Commits**: Generates conventional commit messages based on the actual changes
6. **Pull Request**: Creates a PR with detailed description and AI-generated review instructions
7. **Review Monitoring** (optional): Waits 30 minutes for reviews, then automatically addresses comments
8. **Cleanup**: Returns to main branch and syncs with upstream

### Address Workflow
1. **PR Scanning**: Finds all open PRs with unaddressed comments or failing checks
2. **Comment Detection**: Uses GitHub GraphQL API to find unresolved inline code comments
3. **Task Creation**: Creates address tasks for each comment with proper branch tracking
4. **Automated Fixes**: Implements fixes using Claude Code with repository context
5. **Smart Replies**: Replies to each comment with the commit that addressed it
6. **Review Requests**: Adds context-specific review instructions based on changes

## Architecture

```
ivan/
├── src/
│   ├── database/       # SQLite schema and migrations
│   ├── services/       # Core services
│   │   ├── claude-executor.ts       # Claude Code SDK integration
│   │   ├── openai-service.ts        # OpenAI API for commits/PRs
│   │   ├── job-manager.ts           # Job and task management
│   │   ├── git-manager.ts           # Git operations and GitHub CLI
│   │   ├── task-executor.ts         # Main workflow orchestration
│   │   ├── address-executor.ts      # PR comment addressing workflow
│   │   ├── address-task-executor.ts # Individual comment fix execution
│   │   └── pr-service.ts            # PR comment and check detection
│   ├── config.ts       # Configuration management
│   ├── web-server.ts   # Web interface server
│   └── index.ts        # CLI entry point
├── dist/               # Compiled JavaScript
└── ~/.ivan/            # User configuration and database
    ├── config.json     # API keys and settings
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

### Execution Logs
- All Claude Code interactions are logged with tool calls
- Each response is separated with visual dividers for readability
- Tool inputs and outputs are captured for debugging
- Logs are stored in the database for each task

### Smart Review Comments
- PRs are created with AI-generated review instructions
- Review comments are specific to the changes made
- Uses GPT-4o-mini to analyze diffs and generate contextual review requests
- Replies to PR comments include "Ivan:" prefix for clear attribution

### Comment Detection
- Uses GitHub GraphQL API to detect resolved status
- Only processes unresolved inline code comments
- Ignores top-level PR comments
- Skips comments that already have replies

## Security Considerations

- API keys are stored locally in `~/.ivan/config.json`
- No credentials are stored in the database
- Configuration prompts mask API key input
- Each task runs in the local environment with your git credentials
- GitHub CLI authentication is used for PR creation

## Limitations

- Requires GitHub CLI (`gh`) for pull request creation
- Works with GitHub repositories (GitLab/Bitbucket support planned)
- Tasks must be completable by Claude Code
- Requires active internet connection for AI services

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT

## Support

For issues, questions, or suggestions, please open an issue on GitHub.

## Troubleshooting

### Common Issues

**GitHub CLI not authenticated:**
```bash
gh auth login
```

**API keys not working:**
```bash
ivan reconfigure
```

**Permission denied errors:**
- Ensure you have write access to the repository
- Check that your SSH keys are properly configured

**Web server issues:**
- Check if port is already in use
- Try a different port with `--port` flag

---

Built with ❤️ to make AI-powered development workflows more efficient and automated.