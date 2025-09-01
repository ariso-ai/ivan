# Ivan 🤖

## Your Intelligent Coding Orchestration Agent

Ivan is a powerful CLI tool that orchestrates AI-powered development tasks across your codebase. It breaks down complex requests into manageable tasks, executes them in isolated Docker containers, and automatically commits the results with meaningful messages.

## Features

- **🧠 Intelligent Task Planning**: Uses Claude Code to analyze your request and break it down into atomic, executable tasks
- **🐳 Containerized Execution**: Each task runs in its own Docker container for isolation and reproducibility
- **🔄 Parallel Processing**: Tasks are executed independently, allowing for efficient parallel processing
- **📝 Smart Commits**: Automatically generates meaningful commit messages using OpenAI GPT-4
- **🌿 Branch Management**: Creates separate branches for each task (`ivan/task-name`)
- **📊 Progress Tracking**: SQLite database tracks jobs, tasks, and execution status
- **🔐 Secure Integration**: Safely mounts SSH and Claude credentials for repository access

## Prerequisites

- Node.js 20+
- Docker
- Claude Code CLI installed and configured
- OpenAI API key
- Git configured with SSH access to your repositories

## Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/ivan.git
cd ivan

# Install dependencies
npm install

# Build the project
npm run build

# Link globally (optional)
npm link
```

## Configuration

Run the configuration wizard on first use:

```bash
ivan
```

Or reconfigure at any time:

```bash
ivan configure
```

You'll be prompted for:
- **Repository URL**: The remote repository Ivan will work with
- **OpenAI API Key**: For generating commit messages

Configuration is stored in `~/.ivan/config.json`

## Usage

### Interactive Mode

Simply run:

```bash
ivan
```

Then enter your task when prompted. For example:
- "Add user authentication with JWT tokens"
- "Refactor the database module to use connection pooling"
- "Add comprehensive error handling to all API endpoints"

### How It Works

1. **Task Planning**: Ivan sends your request to Claude Code, which breaks it down into specific, atomic tasks
2. **Job Creation**: A job is created in the database with individual tasks
3. **Containerized Execution**: Each task runs in a Docker container that:
   - Clones your repository
   - Creates a new branch (`ivan/task-name`)
   - Executes Claude Code with the task description
   - Commits changes with an AI-generated message
4. **Status Tracking**: Real-time updates on task progress and completion

## Architecture

```
ivan/
├── src/
│   ├── config/         # Configuration management
│   ├── database/       # SQLite schema and migrations
│   ├── services/       # Core services
│   │   ├── claude-planner.ts    # Task planning with Claude
│   │   ├── job-manager.ts       # Job and task management
│   │   └── docker-orchestrator.ts # Container orchestration
│   └── scripts/        # Container execution scripts
├── dist/               # Compiled JavaScript
└── ~/.ivan/            # User configuration and database
    ├── config.json     # User settings
    └── db.sqlite       # Job and task database
```

## Database Schema

Ivan maintains a local SQLite database to track:
- **Jobs**: High-level user requests
- **Tasks**: Individual atomic tasks within a job
- **Agents**: AI agents used for execution
- **Executions**: Detailed execution history

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

- SSH keys are mounted read-only in containers
- Claude credentials are mounted read-only
- Each task runs in an isolated container
- No credentials are stored in the database
- OpenAI API key is stored locally in config

## Limitations

- Requires Docker to be installed and running
- Tasks must be completable by Claude Code
- Repository must be accessible via SSH
- Currently works with Git repositories only

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT

## Support

For issues, questions, or suggestions, please open an issue on GitHub.

---

Built with ❤️ to make AI-powered development workflows more efficient and manageable.