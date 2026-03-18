// Orchestrates the full end-to-end PR ingestion pipeline:
// fetch GitHub evidence -> build signals -> write JSONL -> extract learnings -> rebuild DB.

import type { LearningsBuildResult } from './builder.js';
import {
  buildEvidenceSignalsFromPullRequest,
  writeEvidenceSignals
} from './evidence-writer.js';
import { extractLearningsFromEvidence } from './extractor.js';
import { fetchGitHubPullRequestEvidence } from './github-evidence.js';
import type { EvidenceContextCache } from './record-types.js';
import {
  ensureLearningsDirectories,
  resolveLearningsRepositoryContext
} from './repository.js';

/**
 * Fetches and writes evidence signals for a single PR without running extraction or rebuild.
 * Returns the written signal count and the in-memory context cache for later extraction.
 * Used by `ingest-repo` to batch multiple PRs before a single extract+rebuild pass.
 */
export async function ingestPullRequestEvidenceOnly(
  repoPath: string,
  prNumber: number
): Promise<{ writtenEvidenceCount: number; contextCache: EvidenceContextCache }> {
  const context = resolveLearningsRepositoryContext(repoPath);
  ensureLearningsDirectories(context);

  const payload = await fetchGitHubPullRequestEvidence(context.repoPath, prNumber);
  const { signals, contextCache } = buildEvidenceSignalsFromPullRequest(payload);
  writeEvidenceSignals(context.repoPath, signals);

  return { writtenEvidenceCount: signals.length, contextCache };
}

/** Returned by `ingestPullRequestEvidence`; summarises the full ingestion outcome. */
export interface PullRequestIngestionResult {
  writtenEvidenceCount: number;
  writtenPaths: string[];
  rebuild: LearningsBuildResult;
}

/**
 * Runs the full ingestion pipeline for a single PR: resolves the repo context, fetches
 * all GitHub evidence, writes JSONL, extracts learnings, and rebuilds the SQLite index.
 */
export async function ingestPullRequestEvidence(
  repoPath: string,
  prNumber: number
): Promise<PullRequestIngestionResult> {
  const context = resolveLearningsRepositoryContext(repoPath);
  ensureLearningsDirectories(context);

  const payload = await fetchGitHubPullRequestEvidence(context.repoPath, prNumber);
  const { signals, contextCache } = buildEvidenceSignalsFromPullRequest(payload);
  const writtenPaths = writeEvidenceSignals(context.repoPath, signals);
  const extraction = await extractLearningsFromEvidence(context.repoPath, contextCache);

  return {
    writtenEvidenceCount: signals.length,
    writtenPaths,
    rebuild: extraction.rebuild
  };
}
