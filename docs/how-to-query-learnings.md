# How to query learnings

Use `ivan learnings query` to search your local learnings database. No network access is needed—everything runs against the local SQLite file.

## Basic query

```bash
ivan learnings query --repo . --text "async error handling"
```

Returns up to five learnings, each showing the statement, metadata (id, kind, confidence, tags), rationale, applicability, and linked evidence.

## Limit the number of results

```bash
ivan learnings query --repo . --text "database migrations" --limit 10
```

## Interpret confidence scores

| Score | Meaning |
|---|---|
| 0.35–0.50 | Low confidence — treat as a hint, not a rule |
| 0.51–0.70 | Moderate confidence — worth considering |
| 0.71–0.95 | High confidence — strong signal from multiple high-weight evidence items |

Confidence is derived from the `final_weight` of the evidence that produced the learning. A `CHANGES_REQUESTED` review with substantial body text will produce higher confidence than a passing CI check.

## How search works

The query runs three strategies in order, returning the first set of results:

1. **Vector search** — embeds the query text and computes cosine similarity against all active learning embeddings. Results with similarity ≥ 0.12 are returned, sorted by score then confidence.
2. **FTS5 full-text search** — extracts unique terms from the query and runs a BM25-ranked SQLite FTS match.
3. **LIKE fallback** — if neither strategy finds anything, a `LIKE %text%` scan runs against statement, title, rationale, and applicability fields.

Short queries (one or two words) tend to work best with vector search; longer natural-language questions benefit from FTS.

## Query from a script

The command exits 0 even when no results are found. Check for the "No learnings matched" string if you need to distinguish:

```bash
output=$(ivan learnings query --repo . --text "$PROMPT" --limit 3)
if [[ "$output" != *"No learnings matched"* && -n "$output" ]]; then
  echo "$output"
fi
```

This is exactly how the Claude Code hook scripts work.
