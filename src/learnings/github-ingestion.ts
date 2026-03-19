// Orchestrates the full end-to-end PR ingestion pipeline:
// fetch GitHub evidence -> build in-memory signals -> extract learnings -> rebuild DB.

import type { LearningsBuildResult } from './builder.js';
import { buildEvidenceSignalsFromPullRequest } from './evidence-writer.js';
import type { BuildSignalsResult } from './evidence-writer.js';
import { extractLearningsFromEvidence } from './extractor.js';
import { fetchGitHubPullRequestEvidence } from './github-evidence.js';
import {
  ensureLearningsDirectories,
  resolveLearningsRepositoryContext
} from './repository.js';

/** Returned by `ingestPullRequestEvidence`; summarises the full ingestion outcome. */
export interface PullRequestIngestionResult {
  writtenPaths: string[];
  rebuild: LearningsBuildResult;
}

/**
 * Fetches signals for a single PR without running extraction.
 * Used by `ingest-repo` to batch multiple PRs before a single extract pass.
 */
export async function fetchPullRequestSignals(
  repoPath: string,
  prNumber: number
): Promise<BuildSignalsResult> {
  const payload = await fetchGitHubPullRequestEvidence(repoPath, prNumber);
  return buildEvidenceSignalsFromPullRequest(payload);
}

/**
 * Runs the full ingestion pipeline for a single PR: fetches GitHub evidence,
 * extracts learnings, and rebuilds the SQLite index.
 */
export async function ingestPullRequestEvidence(
  repoPath: string,
  prNumber: number
): Promise<PullRequestIngestionResult> {
  const context = resolveLearningsRepositoryContext(repoPath);
  ensureLearningsDirectories(context);

  const { signals, contextCache } = await fetchPullRequestSignals(
    repoPath,
    prNumber
  );
  const extraction = await extractLearningsFromEvidence(
    repoPath,
    signals,
    contextCache
  );

  return {
    writtenPaths: extraction.writtenPaths,
    rebuild: extraction.rebuild
  };
}
