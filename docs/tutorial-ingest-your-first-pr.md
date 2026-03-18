# Tutorial: Ingest your first pull request

In this tutorial you will set up the learnings store in a local repository and ingest one GitHub pull request. By the end you will have a `.ivan/db.sqlite` file you can query from the command line.

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
Created directories:
  - /path/to/your-project/.ivan
Created files:
  - /path/to/your-project/.ivan/lessons.jsonl
```

Notice the new `.ivan/` directory. `init` also adds `.ivan/evidence.jsonl` to your `.gitignore` — evidence is kept locally for re-extraction but is not committed to the repository.

---

## Step 2 — Ingest a pull request

Pick a recently merged PR number from your repository. Replace `42` with your actual PR number:

```bash
ivan learnings ingest-pr --repo . --pr 42
```

Ivan fetches all evidence for that PR from GitHub (comments, reviews, review threads, CI checks) and writes it to `.ivan/evidence.jsonl`.

Then it immediately runs the extraction pipeline and rebuilds the database:

```
✅ GitHub PR evidence ingested
Repository ID: repo_your-project-name
Evidence records written: 8
Rebuilt DB: /path/to/your-project/.ivan/db.sqlite
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

You have a fully functional local learnings store. `lessons.jsonl` is version-controlled and human-readable. `evidence.jsonl` is gitignored — it lives locally so you can re-run extraction without hitting GitHub again, but it is never committed. `db.sqlite` is a derived, queryable index you regenerate any time with `ivan learnings rebuild --repo .`.

**Next**: Follow the [how-to guide for installing Claude Code hooks](how-to-install-claude-hooks.md) to have relevant learnings surface automatically inside every Claude session.
