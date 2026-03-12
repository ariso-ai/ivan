# Tutorial: Ingest your first pull request

In this tutorial you will set up the learnings store in a local repository and ingest one GitHub pull request. By the end you will have a `learnings.db` file you can query from the command line.

## Before you begin

- `node` 18+ and `npm` installed
- The `ivan` CLI built and on your `PATH` (`npm run build && npm link` from the repo root)
- A local git repository connected to GitHub
- Either the `gh` CLI authenticated (`gh auth login`) **or** a GitHub PAT configured in ivan

---

## Step 1 — Initialise the learnings store

From your project root, run:

```bash
ivan learnings init --repo .
```

You will see:

```
✅ Learnings store initialized
Repository ID: repo_your-project-name
Repository record: /path/to/your-project/learnings/repositories.jsonl
Created directories:
  - /path/to/your-project/learnings
  - /path/to/your-project/learnings/evidence
  - /path/to/your-project/learnings/lessons
Updated .gitignore with learnings.db exclusions
```

Notice three new directories under `learnings/` and a new line in `.gitignore`. The SQLite database is excluded from version control because it is a derived artifact—you can always rebuild it.

---

## Step 2 — Ingest a pull request

Pick a recently merged PR number from your repository. Replace `42` with your actual PR number:

```bash
ivan learnings ingest-pr --repo . --pr 42
```

Ivan fetches all evidence for that PR from GitHub (comments, reviews, review threads, CI checks) and writes it to `learnings/evidence/repo_your-project-name.jsonl`.

Then it immediately runs the extraction pipeline and rebuilds the database:

```
✅ GitHub PR evidence ingested
Repository ID: repo_your-project-name
Evidence records written: 8
Rebuilt DB: /path/to/your-project/learnings.db
```

---

## Step 3 — Query what was learned

```bash
ivan learnings query --repo . --text "error handling"
```

You will see up to five learnings relevant to "error handling", each with its statement, confidence score, and a link back to the evidence:

```
1. Avoid swallowing errors silently in async functions
   id=lrn_abc123 | repo=repo_your-project-name | kind=engineering_lesson | confidence=0.65 | tags=async
   Rationale: ...
   Evidence: ev_xyz | pr_review_thread | weight=5 | https://github.com/...
```

---

## What you built

You have a fully functional local learnings store. The JSONL files under `learnings/` are version-controlled and human-readable; the `learnings.db` SQLite file is a fast, queryable index you regenerate any time with `ivan learnings rebuild --repo .`.

**Next**: Follow the [how-to guide for installing Claude Code hooks](how-to-install-claude-hooks.md) to have relevant learnings surface automatically inside every Claude session.
