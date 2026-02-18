import { Selectable } from 'kysely';
import { Repository } from '../database.js';

// Common types shared across implementations
export interface PullRequest {
  number: number;
  title: string;
  branch: string;
  url: string;
  hasUnaddressedComments: boolean;
  hasFailingChecks: boolean;
  unaddressedComments: PRComment[];
  failingChecks: string[];
  hasTestOrLintFailures: boolean;
  testOrLintFailures: string[];
}

export interface PRComment {
  id: string;
  author: string;
  body: string;
  createdAt: string;
  path?: string;
  line?: number;
}

export interface PRInfo {
  headRefName: string;
  number: number;
  title: string;
  url: string;
}

export interface RepositoryInfo {
  name: string;
  branch: string;
}

// Service interfaces
export interface IGitManager {
  quietMode: boolean;
  validateGitHubCliInstallation(): void;
  validateGitHubCliAuthentication(): void;
  createBranch(branchName: string): Promise<void>;
  commitChanges(message: string): Promise<void>;
  createEmptyCommit(message: string): Promise<void>;
  pushBranch(branchName: string): Promise<void>;
  createPullRequest(title: string, body: string): Promise<string>;
  getChangedFiles(from?: string, to?: string): string[];
  getDiff(from?: string, to?: string): string;
  getCurrentBranch(): string;
  getMainBranch(): string;
  cleanupAndSyncMain(): Promise<void>;
  generateBranchName(taskDescription: string): string;
  getPRInfo(prNumber: number): Promise<PRInfo>;
  createWorktree(branchName: string): Promise<string>;
  removeWorktree(branchName: string): Promise<void>;
  switchToWorktree(worktreePath: string): void;
  switchToOriginalDir(): void;
  getWorktreePath(branchName: string): string;
}

export interface IPRService {
  getSpecificPRWithIssues(prNumber: number): Promise<PullRequest[]>;
  getOpenPRsWithIssues(fromUser?: string): Promise<PullRequest[]>;
  getUnaddressedComments(prNumber: number): Promise<PRComment[]>;
  checkoutPRBranch(prNumber: number): Promise<void>;
  getFailingActionLogs(prNumber: number): Promise<string>;
}

export interface IRepositoryManager {
  getValidWorkingDirectory(): Promise<string>;
  getRepositoryInfo(workingDir: string): RepositoryInfo;
  getOrCreateRepository(workingDir: string): Promise<Selectable<Repository>>;
  close(): void;
}
