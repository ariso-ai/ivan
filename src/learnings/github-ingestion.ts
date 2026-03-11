import type { LearningsBuildResult } from './builder.js';
import {
  buildEvidenceRecordsFromPullRequest,
  writeEvidenceRecords
} from './evidence-writer.js';
import { extractLearningsFromEvidence } from './extractor.js';
import { fetchGitHubPullRequestEvidence } from './github-evidence.js';
import {
  ensureLearningsDirectories,
  resolveLearningsRepositoryContext,
  writeRepositoryRecord
} from './repository.js';

export interface PullRequestIngestionResult {
  repositoryId: string;
  writtenEvidenceCount: number;
  writtenPaths: string[];
  rebuild: LearningsBuildResult;
}

export async function ingestPullRequestEvidence(
  repoPath: string,
  prNumber: number
): Promise<PullRequestIngestionResult> {
  const context = resolveLearningsRepositoryContext(repoPath);
  ensureLearningsDirectories(context);
  writeRepositoryRecord(context);

  const payload = await fetchGitHubPullRequestEvidence(context.repoPath, prNumber);
  const records = buildEvidenceRecordsFromPullRequest(
    context.repositoryId,
    payload
  );
  const writtenPaths = writeEvidenceRecords(
    context.repoPath,
    context.repositoryId,
    records
  );
  const extraction = extractLearningsFromEvidence(context.repoPath);

  return {
    repositoryId: context.repositoryId,
    writtenEvidenceCount: records.length,
    writtenPaths,
    rebuild: extraction.rebuild
  };
}
