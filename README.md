# Ivan 🤖

## Your AI-Powered Development Assistant

Ivan is an intelligent CLI tool that automates complex development workflows by breaking down high-level requests into executable tasks, implementing them with AI assistance, and creating pull requests with properly formatted commits and descriptions.

## Key Features

- **🧠 Intelligent Task Breakdown**: Analyzes your request and automatically breaks it down into manageable, PR-ready tasks
- **🤖 Claude Code Integration**: Leverages Anthropic's Claude Code SDK for advanced code generation and modification
- **🔄 Automated Git Workflow**: Creates branches, commits changes, and opens pull requests automatically
- **📝 Smart Commit Messages**: Generates conventional commit messages using OpenAI's GPT-4
- **🎯 Repository-Specific Instructions**: Set coding guidelines and patterns that are automatically applied to every task
- **📊 Progress Tracking**: SQLite database tracks all jobs, tasks, and execution history
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

Configuration is stored in `~/.ivan/config.json` and the database in `~/.ivan/db.sqlite`

## Usage

### Running Tasks

Simply run `ivan` in any git repository:

```bash
ivan
```

Then describe what you want to accomplish. Ivan will:
1. Break down your request into individual tasks
2. Execute each task using Claude Code
3. Create pull requests with proper commits

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
# Ivan will prompt for instructions when you first use it in a repository
# Instructions can include:
- Coding style preferences
- Framework-specific patterns
- Testing requirements
- Documentation standards
```

## How It Works

1. **Task Analysis**: Claude Code analyzes your request and breaks it into PR-ready tasks
2. **Branch Creation**: Creates a new branch for each task (`ivan/task-description`)
3. **Code Implementation**: Claude Code implements the changes using your repository context
4. **Smart Commits**: Generates conventional commit messages based on the actual changes
5. **Pull Request**: Creates a PR with a detailed description of what was implemented
6. **Cleanup**: Returns to main branch and syncs with upstream

## Architecture

```
ivan/
├── src/
│   ├── database/       # SQLite schema and migrations
│   ├── services/       # Core services
│   │   ├── claude-executor.ts   # Claude Code SDK integration
│   │   ├── openai-service.ts    # OpenAI API for commits/PRs
│   │   ├── job-manager.ts       # Job and task management
│   │   ├── git-manager.ts       # Git operations and GitHub CLI
│   │   └── task-executor.ts     # Main workflow orchestration
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
  - Execution status (not_started, active, completed, failed)
  - Pull request links
  - Execution logs
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