# GitHub Action Setup Instructions

## Setting up the `/build` Command Workflow

This workflow allows core contributors to trigger automated builds from issue comments using the `/build` command.

### Prerequisites

1. **Anthropic API Key**: You need an Anthropic API key to use Claude Code Action
   - Get your API key from: https://console.anthropic.com/settings/keys
   - API keys start with `sk-ant-`

2. **GitHub App (Optional but Recommended)**: For better GitHub integration
   - Install the Claude GitHub App: https://github.com/apps/claude
   - This provides better authentication and permissions management

### Required Repository Secrets

You must configure these secrets in your repository settings:

1. **ANTHROPIC_API_KEY** (Required)
   - Navigate to: Settings → Secrets and variables → Actions
   - Click "New repository secret"
   - Name: `ANTHROPIC_API_KEY`
   - Value: Your Anthropic API key (starts with `sk-ant-`)

2. **GITHUB_TOKEN** (Automatically provided)
   - This is automatically available in GitHub Actions
   - No manual configuration needed

### How to Configure Secrets

1. Go to your repository on GitHub
2. Click on **Settings** tab
3. In the left sidebar, click **Secrets and variables** → **Actions**
4. Click **New repository secret**
5. Add the following secret:
   - Name: `ANTHROPIC_API_KEY`
   - Secret: Your Anthropic API key

### Usage

1. Core contributors can comment `/build` on any issue
2. The workflow will:
   - Verify the user has write permissions
   - Create a new branch
   - Run Claude Code to implement the changes from the issue description
   - Create a pull request with the changes
   - Tag @codex for review
   - Comment on the issue with the PR link

### Permissions

Only users with **write** or **admin** permissions to the repository can trigger builds.

### Workflow Features

- **Permission Check**: Validates user has write access before running
- **Automated PR Creation**: Creates PR with AI-generated title and description
- **Issue Linking**: Automatically links PR to the triggering issue
- **Review Request**: Tags @codex for review
- **Status Updates**: Comments on the issue with progress and results

### Troubleshooting

1. **"User does not have write permission"**: The commenter needs to be added as a collaborator with write access
2. **"ANTHROPIC_API_KEY is not set"**: Add the secret in repository settings
3. **No changes created**: The issue description may need more specific implementation details

### Best Practices

1. Write clear, detailed issue descriptions with specific requirements
2. Include acceptance criteria in issues for better results
3. Review the generated PR carefully before merging
4. Consider adding additional reviewers beyond @codex

### Security Considerations

- Never commit API keys directly to the repository
- Regularly rotate your Anthropic API key
- Review permissions of users who can trigger builds
- Monitor usage to prevent abuse