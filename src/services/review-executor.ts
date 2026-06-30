import { randomUUID } from 'crypto';
import { execSync } from 'child_process';
import chalk from 'chalk';
import { DatabaseManager } from '../database.js';
import type { PrReview } from '../database.js';
import { ExecutorFactory } from './executor-factory.js';
import type { IClaudeExecutor } from './executor-factory.js';
import {
  createGitManager,
  createRepositoryManager
} from './service-factory.js';
import type { IRepositoryManager } from './git-interfaces.js';

const REVIEW_SYSTEM_PROMPT = `You are a principal engineer reviewing a pull request. Your job is to provide a thorough, actionable code review.

Focus on:
- Correctness: bugs, logic errors, edge cases, incorrect assumptions
- Security: vulnerabilities, improper input handling, exposed secrets
- Performance: inefficient algorithms, unnecessary work, missing indexes
- Maintainability: overly complex code, missing error handling, unclear logic
- Conventions: adherence to existing patterns in the codebase

Be specific and concrete. For each issue, explain:
1. What the problem is
2. Why it matters
3. How to fix it (with a code example when helpful)

Format your review with clear sections. Start with a brief summary, then list issues by severity (critical, major, minor, nit). If there are no significant issues, say so clearly.`;

export class ReviewExecutor {
  private dbManager: DatabaseManager;
  private claudeExecutor: IClaudeExecutor;
  private repositoryManager: IRepositoryManager;

  constructor() {
    this.dbManager = new DatabaseManager();
    this.claudeExecutor = ExecutorFactory.getExecutor();
    this.repositoryManager = createRepositoryManager();
  }

  async executeReviews(prNumbers: number[]): Promise<void> {
    try {
      await this.claudeExecutor.validateClaudeCodeInstallation();
      console.log(chalk.green('✅ Claude Code SDK configured'));

      const workingDir =
        await this.repositoryManager.getValidWorkingDirectory();
      const gitManager = createGitManager(workingDir);

      gitManager.validateGitHubCliInstallation();
      console.log(chalk.green('✅ GitHub CLI is installed'));

      gitManager.validateGitHubCliAuthentication();
      console.log(chalk.green('✅ GitHub CLI is authenticated'));

      const repoInfo = this.repositoryManager.getRepositoryInfo(workingDir);
      console.log(chalk.blue(`📂 Working in: ${repoInfo.name}`));
      console.log('');

      const repository =
        await this.repositoryManager.getOrCreateRepository(workingDir);

      const jobUuid = randomUUID();
      const jobDescription = `PR Review - ${prNumbers.map((n) => `#${n}`).join(', ')} - ${new Date().toLocaleDateString()}`;
      const db = this.dbManager.getKysely();

      await db
        .insertInto('jobs')
        .values({
          uuid: jobUuid,
          description: jobDescription,
          created_at: new Date().toISOString(),
          directory: workingDir,
          repository_id: repository.id
        })
        .execute();

      console.log(chalk.blue.bold(`📝 Starting reviews for ${prNumbers.length} PR(s)...`));
      console.log('');

      for (const prNumber of prNumbers) {
        await this.reviewPR(prNumber, jobUuid, repository.id, workingDir);
      }

      console.log('');
      console.log(chalk.green.bold('🎉 All reviews completed!'));
    } finally {
      this.dbManager.close();
      this.repositoryManager.close();
    }
  }

  private async reviewPR(
    prNumber: number,
    jobUuid: string,
    repositoryId: number,
    workingDir: string
  ): Promise<void> {
    console.log(chalk.blue.bold(`🔍 Reviewing PR #${prNumber}...`));

    const reviewUuid = randomUUID();
    const db = this.dbManager.getKysely();

    let prTitle: string | null = null;
    let prUrl: string | null = null;

    try {
      const prJson = execSync(
        `gh pr view ${prNumber} --json number,title,url,state`,
        { cwd: workingDir, encoding: 'utf-8' }
      );
      const prInfo = JSON.parse(prJson);

      if (prInfo.state !== 'OPEN') {
        console.log(
          chalk.yellow(`⚠️  PR #${prNumber} is not open (status: ${prInfo.state}), skipping`)
        );
        return;
      }

      prTitle = prInfo.title;
      prUrl = prInfo.url;
      console.log(chalk.gray(`   ${prTitle}`));
    } catch (err) {
      console.log(chalk.red(`❌ Could not fetch PR #${prNumber}: ${err}`));
      return;
    }

    const review: PrReview = {
      uuid: reviewUuid,
      job_uuid: jobUuid,
      pr_number: prNumber,
      pr_url: prUrl,
      pr_title: prTitle,
      status: 'not_started',
      review_log: null,
      review_output: null,
      repository_id: repositoryId,
      created_at: new Date().toISOString()
    };

    await db.insertInto('pr_reviews').values(review).execute();

    await db
      .updateTable('pr_reviews')
      .set({ status: 'active' })
      .where('uuid', '=', reviewUuid)
      .execute();

    let prDiff: string;
    try {
      prDiff = execSync(`gh pr diff ${prNumber}`, {
        cwd: workingDir,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024
      });

      if (!prDiff.trim()) {
        console.log(chalk.yellow(`⚠️  PR #${prNumber} has no diff, skipping`));
        await db
          .updateTable('pr_reviews')
          .set({ status: 'completed', review_output: 'No diff found for this PR.' })
          .where('uuid', '=', reviewUuid)
          .execute();
        return;
      }

      // Truncate very large diffs
      const MAX_DIFF_CHARS = 80000;
      if (prDiff.length > MAX_DIFF_CHARS) {
        prDiff = prDiff.slice(0, MAX_DIFF_CHARS) + '\n\n[... diff truncated due to size ...]';
      }
    } catch (err) {
      console.log(chalk.red(`❌ Could not get diff for PR #${prNumber}: ${err}`));
      await db
        .updateTable('pr_reviews')
        .set({ status: 'failed', review_log: String(err) })
        .where('uuid', '=', reviewUuid)
        .execute();
      return;
    }

    const reviewPrompt = `Please review the following pull request and provide detailed feedback.

PR #${prNumber}: ${prTitle}
URL: ${prUrl}

Here is the diff:

\`\`\`diff
${prDiff}
\`\`\`

Provide a thorough code review. Be specific about any issues found, their severity, and how to fix them. If the code looks good, say so clearly with a brief explanation of why.`;

    try {
      const result = await this.claudeExecutor.executeTurn(
        reviewPrompt,
        workingDir,
        {
          systemPrompt: REVIEW_SYSTEM_PROMPT,
          readOnly: true,
          permissionMode: 'plan'
        }
      );

      await db
        .updateTable('pr_reviews')
        .set({
          status: 'completed',
          review_log: result.log,
          review_output: result.lastMessage
        })
        .where('uuid', '=', reviewUuid)
        .execute();

      console.log(chalk.green(`✅ Review completed for PR #${prNumber}`));
    } catch (err) {
      console.log(chalk.red(`❌ Review failed for PR #${prNumber}: ${err}`));
      await db
        .updateTable('pr_reviews')
        .set({ status: 'failed', review_log: String(err) })
        .where('uuid', '=', reviewUuid)
        .execute();
    }
  }
}
