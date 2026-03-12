# How to rebuild the learnings database

`.ivan/db.sqlite` is a derived artifact. Rebuild it after editing JSONL files directly, after a git pull that changes them, or whenever the database is missing or corrupt.

## Rebuild from the canonical JSONL files

```bash
ivan learnings rebuild --repo /path/to/your-project
```

This drops the existing database and recreates it from scratch. It validates every record first—if any record has a bad ID, a missing field, or a broken cross-reference, the command fails with a list of all issues before touching the database.

Expected output:

```
✅ Learnings database rebuilt
DB: /path/to/your-project/.ivan/db.sqlite
Repositories: 1, evidence: 43, learnings: 17
```

## Re-extract learnings without re-fetching GitHub data

If you want to re-run the extraction heuristics (for example, after updating ivan) without re-fetching PR data from GitHub:

```bash
ivan learnings extract --repo /path/to/your-project
```

This overwrites `.ivan/lessons.jsonl` and then calls `rebuild` automatically.

## Check what is in the database

```bash
ivan learnings query --repo /path/to/your-project --text "testing" --limit 10
```

If the output is empty, either no learnings match the query or the database has not been built yet.
