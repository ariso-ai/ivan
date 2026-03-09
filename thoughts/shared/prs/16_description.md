## What

- **Auto-address loop** — after completing tasks and creating PRs, ivan now prompts to wait 30 minutes for PR reviews and automatically queues address tasks for any comments that come in
- **Repo instructions on-boarding** — when no repo-specific instructions are configured, ivan prompts to set them up inline instead of requiring a separate reconfigure step
- **Address task executor refactor** — tasks are now grouped by branch and run in per-branch git worktrees; lint/test tasks are separated from address tasks and receive failing CI logs in the prompt
- **Claude CLI executor** — per-repo allowed/blocked tools are now respected; model and `--permission-mode bypassPermissions` are passed as explicit CLI flags
- **Code formatting toolchain** — added `.editorconfig`, Prettier (`singleQuote`, `trailingComma: none`), and wired `eslint-config-prettier` to prevent conflicts; `npm run format` and `npm run format:check` scripts added

> Note: the majority of the diff line count is a one-time Prettier formatting pass across all source files, not logic changes.
