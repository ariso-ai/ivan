import type { LearningsBuildResult } from './builder.js';
import {
  buildEvidenceRecordsFromPullRequest,
  writeEvidenceRecords
} from './evidence-writer.js';
import { extractLearningsFromEvidence } from './extractor.js';
import { fetchGitHubPullRequestEvidence } from './github-evidence.js';
import { initLearningsStore } from './init-command.js';

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
  const initResult = await initLearningsStore(repoPath);

  const payload = await fetchGitHubPullRequestEvidence(repoPath, prNumber);
  const records = buildEvidenceRecordsFromPullRequest(
    initResult.repositoryId,
    payload
  );
  const writtenPaths = await writeEvidenceRecords(
    repoPath,
    initResult.repositoryId,
    records
  );
  const extraction = await extractLearningsFromEvidence(repoPath);

  return {
    repositoryId: initResult.repositoryId,
    writtenEvidenceCount: records.length,
    writtenPaths,
    rebuild: extraction.rebuild
  };
}
