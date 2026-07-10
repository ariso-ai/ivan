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
import type { IGitManager, IRepositoryManager } from './git-interfaces.js';
import { queryLearnings } from '../learnings/index.js';
import type { LearningsQueryResult } from '../learnings/types.js';

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
        await this.reviewPR(prNumber, jobUuid, repository.id, workingDir, gitManager);
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
    workingDir: string,
    gitManager: IGitManager
  ): Promise<void> {
    console.log(chalk.blue.bold(`🔍 Reviewing PR #${prNumber}...`));

    const reviewUuid = randomUUID();
    const db = this.dbManager.getKysely();

    let prTitle: string | null = null;
    let prUrl: string | null = null;
    let prBranch: string | null = null;

    try {
      const prJson = execSync(
        `gh pr view ${prNumber} --json number,title,url,state,headRefName`,
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
      prBranch = prInfo.headRefName;
      console.log(chalk.gray(`   ${prTitle} (${prBranch})`));
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

    // Create a worktree for the PR branch so Claude can read the actual code
    let worktreePath: string | null = null;
    try {
      console.log(chalk.cyan(`   Creating worktree for branch: ${prBranch}`));
      worktreePath = await gitManager.createWorktree(prBranch ?? '');
      gitManager.switchToWorktree(worktreePath);
    } catch (err) {
      console.log(chalk.red(`❌ Could not create worktree for PR #${prNumber}: ${err}`));
      await db
        .updateTable('pr_reviews')
        .set({ status: 'failed', review_log: String(err) })
        .where('uuid', '=', reviewUuid)
        .execute();
      return;
    }

    try {
      const learningsSection = await this.buildLearningsSection(
        prNumber,
        prTitle,
        workingDir
      );

      const reviewPrompt = `Please review PR #${prNumber}: "${prTitle}" (${prUrl}).

You are currently checked out on the PR branch \`${prBranch}\`. Use your tools to read the code and understand what this PR changes. You can use git commands to see the diff against the base branch (e.g. \`git diff main...HEAD\` or \`git log --oneline main..HEAD\`).

Provide a thorough code review covering:
- What the PR does and whether the implementation is correct
- Any bugs, logic errors, or edge cases
- Security concerns
- Performance issues
- Adherence to codebase conventions and patterns
- Anything else worth calling out

Be specific and actionable. Reference file names and line numbers where relevant.${learningsSection}`;

      const result = await this.claudeExecutor.executeTurn(
        reviewPrompt,
        worktreePath,
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
    } finally {
      // Always clean up the worktree
      if (worktreePath) {
        try {
          gitManager.switchToOriginalDir();
          await gitManager.removeWorktree(prBranch ?? '');
        } catch (err) {
          console.log(chalk.yellow(`⚠️  Could not clean up worktree: ${err}`));
        }
      }
    }
  }

  /**
   * Queries the repo's learnings database (.ivan/db.sqlite) with the PR title and
   * changed file paths, and formats the closest matches as a prompt section.
   * Returns an empty string when there is no learnings store or nothing matches.
   */
  private async buildLearningsSection(
    prNumber: number,
    prTitle: string | null,
    workingDir: string
  ): Promise<string> {
    let queryText = prTitle ?? '';
    try {
      const filesJson = execSync(`gh pr view ${prNumber} --json files`, {
        cwd: workingDir,
        encoding: 'utf-8'
      });
      const files: Array<{ path: string }> = JSON.parse(filesJson).files ?? [];
      queryText = [queryText, ...files.slice(0, 50).map((f) => f.path)]
        .filter(Boolean)
        .join('\n');
    } catch {
      // Changed-file lookup is best-effort; the title alone is still a usable query.
    }

    let learnings: LearningsQueryResult[] = [];
    try {
      learnings = await queryLearnings(workingDir, queryText, { limit: 10 });
    } catch {
      // No learnings store, or it failed to open — reviews still work without it.
      return '';
    }

    if (learnings.length === 0) {
      return '';
    }

    console.log(
      chalk.cyan(
        `   Including ${learnings.length} relevant learning(s) from past reviews`
      )
    );

    const formatted = learnings
      .map((l) => {
        const label = l.title || l.kind;
        const parts = [`- [${label}] ${l.statement}`];
        if (l.rationale) parts.push(`  Why: ${l.rationale}`);
        if (l.applicability) parts.push(`  When: ${l.applicability}`);
        if (l.source_url) parts.push(`  Source: ${l.source_url}`);
        return parts.join('\n');
      })
      .join('\n');

    return `

## Learnings from past reviews

The following learnings were distilled from this team's past code reviews and repository history. They are the most contextually relevant to this PR. Apply them while reviewing: check whether the changes violate any of them, and cite the learning when you flag an issue based on one.

${formatted}`;
  }
}
