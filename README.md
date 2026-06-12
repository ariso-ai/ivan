<div align="center">

# Ivan 🤖

### The AI engineering teammate that ships pull requests — and remembers your team's lessons while doing it.

Give Ivan a sentence. Ivan breaks it into PR-sized tasks, **debates its own design with a principal-engineer persona**, writes the code, reviews it, opens the PR, and then **handles the review comments too**.

[![npm version](https://img.shields.io/npm/v/@ariso-ai/ivan?color=cb3837&label=npm&logo=npm)](https://www.npmjs.com/package/@ariso-ai/ivan)
[![npm downloads](https://img.shields.io/npm/dm/@ariso-ai/ivan?color=cb3837&logo=npm)](https://www.npmjs.com/package/@ariso-ai/ivan)
[![license](https://img.shields.io/npm/l/@ariso-ai/ivan?color=blue)](#license)
[![Built with Claude](https://img.shields.io/badge/built%20with-Claude-d97757?logo=anthropic&logoColor=white)](https://www.anthropic.com)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#contributing)

```bash
npm i -g @ariso-ai/ivan && ivan "Add rate limiting to the public API"
```

[Quick Start](#-quick-start) · [Expert Mode](#-expert-mode-an-ai-that-argues-with-itself-so-you-dont-have-to) · [Institutional Memory](#-institutional-memory-ivan-learns-your-team) · [Commands](#-cli-reference) · [Contributing](#-contributing)

</div>

---

## Why Ivan?

Most AI coding tools have two problems: they **forget everything** between sessions, and they **ship code that nobody reviewed**. Ivan was built to fix both.

> 🧠 **It remembers.** Ivan distills your team's real PRs and coding sessions into *institutional knowledge*, then injects those hard-won lessons into every future task. The more your team works, the smarter Ivan gets.
>
> 🏛️ **It reviews itself.** In **Expert mode**, a separate principal-engineer persona critiques the plan *and* the diff across multiple rounds before a single line reaches your PR — like having a senior reviewer pair with the implementer, automatically.
>
> 🔁 **It closes the loop.** Ivan doesn't stop at "PR opened." It addresses inline review comments, replies with the fixing commit, and can be triggered straight from a GitHub issue with `@ivan-agent /build`.

Ivan runs **locally, with your credentials**, on top of [Claude Code](https://docs.anthropic.com/claude/docs/claude-code) — bring your Anthropic API key, or a Claude Max subscription via the CLI driver.

---

## 🚀 Quick Start

```bash
# 1. Install
npm i -g @ariso-ai/ivan

# 2. Run it in any git repo — Ivan walks you through API keys & preferences on first run
ivan "Add user authentication with JWT tokens"
```

That's it. Ivan will:

1. 🧩 **Break down** your request into manageable, PR-ready tasks
2. 🌿 **Branch & implement** each one using Claude Code
3. ✍️ **Write** conventional commit messages and a detailed PR description
4. 📬 **Open the PR** with context-specific review instructions

Want Ivan to think harder? Add one flag:

```bash
ivan --mode expert "Refactor the billing module to support proration"
```

---

## 🏛️ Expert Mode: an AI that argues with itself so you don't have to

Ivan ships two execution modes. Pick per-run with `--mode`:

| Mode | What it does | Best for |
| --- | --- | --- |
| **`simple`** *(default)* | A fast, one-shot hand-off to Claude Code. | Quick changes, well-scoped tasks. |
| **`expert`** | A collaborative **architect ↔ implementer** loop, grounded in your team's learnings. | High-stakes changes where design quality matters. |

In **Expert mode**, Ivan splits into two minds. The **Implementer** writes the code. A separate **Architect** session — adopting a principal-engineer persona that *holds your team's institutional knowledge* — challenges it. They go back and forth on the **design**, then on the **diff**, and the Architect decides when the work is good enough to ship.

```
            📚 Institutional knowledge  (your past PRs + coding sessions)
                          │  injected into every round, weighed heavily
                          ▼
   ┌──────────────────┐   plan ──▶ critique ──▶ revise         ┌──────────────────────────┐
   │  🔨 Implementer  │  ═════════════════════════════════════▶ │  🏛️  Architect           │
   │   writes code    │ ◀═════════════════════════════════════ │  principal engineer      │
   └──────────────────┘   APPROVE / APPROVE_WITH_NITS / REVISE │  read-only, never edits  │
                          │                                    └──────────────────────────┘
                          ▼
     📐 Design rounds  ──▶  🛠️  Implementation  ──▶  🔎 Code-review rounds  ──▶  ✅ PR
```

- The Architect is **read-only** — it inspects the codebase to ground its critique but never touches the code.
- Every turn ends with a calibrated verdict — `APPROVE`, `APPROVE_WITH_NITS` (minor notes folded in without another round), or `REVISE` (a blocking issue worth another pass).
- **Rounds are dynamic, not fixed.** The loop ends the moment the Architect approves, bails early if it keeps raising the same unresolved concern, and only runs to the configured cap on genuinely hard tasks. Simple changes finish in a single round.
- By default the Architect runs on a stronger reasoning model (**Claude Opus**) while the Implementer uses your configured model — a senior reviewer + a fast builder.

**Tune it** in `~/.ivan/config.json` (the round counts are *safety ceilings*, not targets):

```jsonc
{
  "collaborative": {
    "architectModel": "claude-opus-4-8", // the reviewer's brain
    "maxDesignRounds": 5,                 // max design back-and-forths before building
    "maxReviewRounds": 3                  // max code-review back-and-forths before shipping
  }
}
```

---

## 🧠 Institutional Memory: Ivan learns your team

Ivan's edge is that it doesn't start every task from zero. The `ivan learn` command builds a durable, queryable store of your team's engineering wisdom — and Expert mode reads from it on every task.

```bash
# Initialize the learnings store in a repo
ivan learn init --repo /path/to/repo

# Learn from your merged PRs (review comments are a goldmine of lessons)
ivan learn ingest-repo --repo /path/to/repo --state merged --limit 100

# Learn from how you actually think — mine your local Claude Code sessions
ivan learn coding-sessions --repo /path/to/repo

# See what Ivan knows
ivan learn query --repo /path/to/repo --text "error handling for async locks"
```

**How it works:**

- 📥 **`ingest-pr` / `ingest-repo`** — fetches PR review feedback from GitHub and distills it into reusable *engineering lessons* and *repo conventions*.
- 🧬 **`coding-sessions`** — analyzes your local Claude Code transcripts to extract **thinking patterns** (how you reason about architecture, product, and quality) and **example interactions** (the questions and corrections that reveal how a senior engineer thinks).
- 💾 **Canonical & committable** — learnings are stored as plain JSONL under `.ivan/`, so they live in git, travel with the repo, and are reviewable like any other artifact. A derived local `.ivan/db.sqlite` powers fast semantic retrieval; queries never hit the network.
- 🪝 **`install-hooks`** — wires Ivan's retrieval surface into Claude Code itself (`UserPromptSubmit` and `PostToolUse(Edit|Write|MultiEdit)`), so the right lesson surfaces at the right moment.

```bash
ivan learn install-hooks --repo /path/to/repo   # learnings show up live, mid-edit
ivan learn rebuild --repo /path/to/repo          # rebuild the derived index
```

---

## 💬 Address review comments — automatically

Ivan treats review feedback and red CI as first-class workflows, not an afterthought.

```bash
ivan address                       # scan all open PRs for unaddressed comments or failing checks
ivan address 123                   # just PR #123
ivan address --from-user alice     # only comments from specific reviewers
ivan address --yes                 # skip confirmation prompts
ivan address --non-interactive     # accept all comments without prompting (CI-friendly)
```

For each unresolved inline comment, Ivan implements the fix, commits it with co-author attribution, and replies to the thread with the fixing commit — using the GitHub GraphQL API to track resolution state so it never double-handles a comment. It can also pick up **failing checks** on a PR and push fixes for them.

---

## ⚙️ GitHub Actions: trigger Ivan from an issue

Turn any issue into a PR. Run once:

```bash
ivan add-action
```

This installs a workflow so that when someone comments `@ivan-agent /build` on an issue, Ivan reads the issue, opens a PR, waits ~15 minutes for reviews, and then runs `ivan address` to handle any comments — fully hands-off.

**Required repository secrets** (Settings → Secrets and variables → Actions):

| Secret | Purpose |
| --- | --- |
| `ANTHROPIC_KEY` | Claude Code execution |
| `OPEN_AI_KEY` | Commit messages & PR descriptions |
| `PAT` | GitHub token with `repo` + `pull_requests` permissions |

---

## 🔌 Drivers: run it your way

Ivan is deliberately flexible about *how* it talks to Claude and to GitHub.

**Claude execution** — switch anytime with `ivan configure-executor`:

- **SDK mode** *(default)* — uses the Anthropic API directly. Reliable, CI/CD-friendly. Needs an `sk-ant-...` key.
- **CLI mode** — drives your locally installed Claude Code CLI. **No API costs for Claude Max subscribers**, with real-time streaming output.

**GitHub auth** — chosen during setup:

- **GitHub CLI** *(default)* — `gh auth login`, easy and secure for local use.
- **Personal Access Token (PAT)** — for CI, Actions, and non-interactive environments.

---

## 🛠️ Configuration

Ivan prompts for everything it needs on first run. Settings live in `~/.ivan/config.json`; the local database in `~/.ivan/db.sqlite`.

```bash
ivan reconfigure              # re-run the full setup
ivan configure-executor       # SDK (API) vs CLI (Claude Max)
ivan choose-model             # pick the implementer model
ivan configure-review-agent   # which bot to tag for PR reviews
ivan show-config              # view current settings
```

**Models** (`ivan choose-model`):

- **Claude Sonnet 4.6** — recommended default, great balance of speed and quality
- **Claude Haiku 4.5** — faster, ideal for simpler tasks
- **Claude Opus 4.8** — most capable, slower (and the default Architect in Expert mode)

**Per-repository settings:**

```bash
ivan edit-repo-instructions   # coding guidelines applied to every task in this repo
ivan config-tools             # allow-list tools Claude Code may use
ivan config-blocked-tools     # block specific tools (least-privilege by repo)
```

---

## 📋 CLI Reference

<details>
<summary><strong>Core</strong></summary>

```bash
ivan                          # interactive: Ivan asks what to build
ivan "task description"       # headless: run a task directly
ivan --mode expert "task"     # collaborative architect ↔ implementer loop
ivan --base-branch dev "task" # branch work off a specific local base branch
ivan -c config.json           # run from a JSON config (CI-friendly)
ivan -c '{"tasks":["A","B"],"mode":"expert"}'   # inline JSON config
ivan address [PR#]            # address PR review comments or failing checks
ivan add-action               # install the GitHub Actions workflow
```

</details>

<details>
<summary><strong>Configuration</strong></summary>

```bash
ivan reconfigure
ivan configure-executor       # SDK vs CLI
ivan choose-model             # Sonnet / Haiku / Opus
ivan configure-review-agent   # PR review bot
ivan show-config
ivan edit-repo-instructions
ivan config-tools
ivan config-blocked-tools
```

</details>

<details>
<summary><strong>Learnings (<code>ivan learn</code>, alias <code>ivan learnings</code>)</strong></summary>

```bash
ivan learn init --repo <path>
ivan learn ingest-pr --repo <path> --pr <number>
ivan learn ingest-repo --repo <path> [--state merged|open|closed|all] [--limit N]
ivan learn coding-sessions --repo <path> [--project <name>] [--recent <days>] [--dry-run] [--force] [--reset]
ivan learn install-hooks --repo <path>
ivan learn rebuild --repo <path> [--if-stale]
ivan learn query --repo <path> --text "<search>" [--limit N]
```

</details>

<details>
<summary><strong>Web interface</strong></summary>

```bash
ivan web [--port <port>]      # monitor jobs, tasks, logs & PR links in your browser
ivan web-stop [--port <port>]
```

Open http://localhost:3000 to watch jobs, task progress, execution logs, and PR links in real time.

</details>

---

## 🔍 How It Works

**Build workflow**

```
request ─▶ task breakdown ─▶ branch ─▶ implement ─▶ smart commit ─▶ PR
                                  │                                    │
                          (expert mode: design + review rounds)  (optional: wait & auto-address)
```

**Address workflow** — finds unresolved inline comments via the GitHub GraphQL API, implements each fix, replies with the fixing commit, and adds context-specific review instructions.

**Everything is tracked** — a local SQLite database records every job, task, status transition, branch, PR link, and Claude Code tool call, viewable through `ivan web`.

---

## 🏗️ Architecture

```
ivan/
├── src/
│   ├── services/
│   │   ├── task-executor.ts          # orchestrates the build workflow (simple | expert)
│   │   ├── collaborative-executor.ts # the architect ↔ implementer loop (expert mode)
│   │   ├── claude-executor.ts        # Claude Code SDK driver
│   │   ├── claude-cli-executor.ts    # Claude Code CLI driver (Claude Max)
│   │   ├── address-executor.ts       # PR comment addressing workflow
│   │   ├── git-manager-*.ts          # git ops over gh CLI or PAT
│   │   └── openai-service.ts         # commit messages & PR descriptions
│   ├── learnings/                    # institutional-knowledge pipeline
│   │   ├── ingest-*.ts               # PR & repo evidence ingestion
│   │   ├── session-analyzer.ts       # mines Claude Code sessions for thinking patterns
│   │   ├── extractor.ts              # distills evidence into reusable lessons
│   │   └── builder.ts                # rebuilds the derived sqlite index
│   ├── config.ts                     # drivers, auth, models, collaborative settings
│   ├── web-server.ts                 # job/task dashboard
│   └── index.ts                      # CLI entry point
├── .github/workflows/ivanagent.yml   # @ivan-agent /build automation
└── ~/.ivan/                          # config.json + db.sqlite (per user)
```

---

## 🤝 Contributing

Ivan is open source and contributions are genuinely welcome — whether it's a bug fix, a new driver, better learnings extraction, or docs.

```bash
git clone https://github.com/ariso-ai/ivan.git
cd ivan
npm install
npm run build      # compile TypeScript
npm link           # use your local build as the global `ivan`

# Development
npm run dev        # run from source with tsx
npm run watch      # rebuild on change
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
npm test           # build + jest
```

Found a bug or have an idea? [Open an issue](https://github.com/ariso-ai/ivan/issues) or send a PR. If Ivan saved you time, a ⭐ on the repo helps other developers find it.

---

## 🔐 Security

- **Keys stay local** — stored in `~/.ivan/config.json`, never in the database, and masked on entry.
- **Your environment, your credentials** — tasks run locally; nothing is executed on someone else's infrastructure.
- **Least privilege** — restrict Claude Code's tools per repository with `ivan config-tools` / `ivan config-blocked-tools`.
- **CI secrets** — for GitHub Actions, keys live in GitHub's encrypted secrets store.

---

## 📦 Limitations

- **GitHub-first** — GitLab / Bitbucket support is on the roadmap.
- **Internet required** — Claude and OpenAI are called over the network.
- **Scope** — tasks must be completable by Claude Code in your repo.

---

## License

Released under the **MIT License**.

© ariso.ai

**Built with ❤️ to make AI-powered engineering reviewable, repeatable, and a little bit wiser every day.**

If Ivan ships you a good PR, give it a ⭐
