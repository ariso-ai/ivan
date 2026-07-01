import { randomUUID } from 'crypto';
import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import chalk from 'chalk';
import { DatabaseManager } from '../database.js';
import type { PrReview } from '../database.js';
import { ExecutorFactory } from './executor-factory.js';
import type { IClaudeExecutor } from './executor-factory.js';
import { OpenAIService } from './openai-service.js';
import {
  createGitManager,
  createRepositoryManager
} from './service-factory.js';
import type { IGitManager, IRepositoryManager } from './git-interfaces.js';

const REVIEW_SYSTEM_PROMPT = `You are a principal engineer helping a human reviewer understand and evaluate a pull request.

Your primary goal is to set the human reviewer up for success — not to rubber-stamp the PR, but to give them everything they need to make a confident, informed decision. Structure your output so they know exactly where to focus their attention.

Your review should:
1. **Summarize what the PR does** — a concise description of the intent and approach, so the reviewer isn't starting cold.
2. **Call out critical spots to check** — specific files, functions, or logic paths that carry the most risk and deserve careful human scrutiny. Explain *why* each one matters.
3. **Flag real issues** — bugs, security holes, performance problems, or correctness failures you found. Be concrete: file name, line range, what's wrong, why it matters, how to fix it.
4. **Note conventions and patterns** — deviations from existing codebase conventions worth discussing.
5. **Surface anything surprising** — side effects, missing tests for tricky logic, assumptions baked into the implementation.

Severity levels: **critical** (must fix before merge), **major** (should fix), **minor** (worth discussing), **nit** (optional polish).

Be direct and specific. Reference exact file paths and line numbers. If something looks fine, say so — don't pad with generic praise.`;

// Kept as reference for the prompt contract passed to OpenAI in extractPrComments()
export const COMMENT_SYSTEM_PROMPT = `You are a principal engineer leaving inline review comments on a GitHub pull request.

You have already produced a written review summary. Your task now is to translate the actionable findings from that review into structured inline comments to post on the PR via the GitHub CLI.

For each comment you want to leave:
- Identify the exact file path and line number (use the line from the PR diff perspective)
- Write a concise, helpful comment that explains the issue and, where possible, how to fix it
- Only comment on lines that appear in the PR diff (changed lines or their immediate context)
- Skip issues that are too vague to pin to a specific location

Output a JSON array of comment objects with this shape:
[
  {
    "path": "src/some/file.ts",
    "line": 42,
    "body": "This function doesn't handle the case where X is null — if Y calls this with an uninitialized value it will throw. Consider adding a guard here."
  }
]

Return ONLY valid JSON — no prose, no markdown fences, just the raw array.`;

export class ReviewExecutor {
  private dbManager: DatabaseManager;
  private claudeExecutor: IClaudeExecutor;
  private repositoryManager: IRepositoryManager;
  private openAIService: OpenAIService;

  constructor() {
    this.dbManager = new DatabaseManager();
    this.claudeExecutor = ExecutorFactory.getExecutor();
    this.repositoryManager = createRepositoryManager();
    this.openAIService = new OpenAIService();
  }

  async executeReviews(prNumbers: number[], leaveComments = false): Promise<void> {
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
        await this.reviewPR(prNumber, jobUuid, repository.id, workingDir, gitManager, leaveComments);
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
    gitManager: IGitManager,
    leaveComments: boolean
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
      const reviewPrompt = `Please review PR #${prNumber}: "${prTitle}" (${prUrl}).

You are currently checked out on the PR branch \`${prBranch}\`. Use your tools to read the code and understand what this PR changes. Start by running \`git log --oneline main..HEAD\` and \`git diff main...HEAD\` to see what changed, then read the relevant files to understand the full context.

Your review should help a human reviewer know exactly what to look at and what to watch out for. Structure it as follows:

1. **What this PR does** — a concise summary of the intent and implementation approach
2. **Critical spots to check** — specific files and functions the reviewer should scrutinize closely, with a brief explanation of why each one carries risk
3. **Issues found** — concrete bugs, security concerns, performance problems, or correctness failures, each with file path, line range, a criticality level (trivial/low/medium/urgent/critical), and a suggested fix
4. **Convention notes** — anything that deviates from existing patterns in the codebase
5. **Overall assessment** — approve, request changes, or needs discussion

Be specific. Reference exact file paths and line numbers. If the PR looks solid in a particular area, say so briefly.`;

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

      if (leaveComments && result.lastMessage) {
        await this.postInlineComments(prNumber, result.lastMessage, workingDir);
      }
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

  private async postInlineComments(
    prNumber: number,
    reviewOutput: string,
    workingDir: string
  ): Promise<void> {
    console.log(chalk.cyan(`   Extracting inline comments for PR #${prNumber} via OpenAI...`));

    let comments: Array<{ path: string; line: number; criticality: string; body: string }>;
    try {
      comments = await this.openAIService.extractPrComments(reviewOutput, prNumber);
    } catch (err) {
      console.log(chalk.yellow(`⚠️  Could not extract inline comments: ${err}`));
      return;
    }

    if (comments.length === 0) {
      console.log(chalk.gray(`   No inline comments to post for PR #${prNumber}`));
      return;
    }

    // GitHub's pull review comment API requires the head commit SHA
    let commitId: string;
    try {
      const prJson = execSync(
        `gh pr view ${prNumber} --json headRefOid`,
        { cwd: workingDir, encoding: 'utf-8' }
      );
      commitId = JSON.parse(prJson).headRefOid;
      if (!commitId) throw new Error('headRefOid was empty');
    } catch (err) {
      console.log(chalk.yellow(`⚠️  Could not fetch PR head SHA, aborting inline comments: ${err}`));
      return;
    }

    console.log(chalk.cyan(`   Posting ${comments.length} inline comment(s) on PR #${prNumber}...`));

    const CRITICALITY_EMOJI: Record<string, string> = {
      trivial:  '🔵',
      low:      '🟢',
      medium:   '🟡',
      urgent:   '🟠',
      critical: '🔴'
    };

    let posted = 0;
    let failed = 0;
    for (const comment of comments) {
      const emoji = CRITICALITY_EMOJI[comment.criticality] ?? '⚪';
      const header = `${emoji} **${comment.criticality.charAt(0).toUpperCase() + comment.criticality.slice(1)}**`;
      const fullBody = `${header}\n\n${comment.body}`;
      const tmpFile = join(tmpdir(), `ivan-comment-${randomUUID()}.txt`);
      try {
        writeFileSync(tmpFile, fullBody, 'utf-8');
        try {
          execSync(
            `gh api repos/:owner/:repo/pulls/${prNumber}/comments --method POST` +
            ` -f commit_id=${commitId}` +
            ` -f path=${comment.path}` +
            ` -F line=${comment.line}` +
            ` -f side=RIGHT` +
            ` -F body=@"${tmpFile}"`,
            { cwd: workingDir, encoding: 'utf-8', stdio: 'pipe' }
          );
          posted++;
        } catch (err) {
          console.log(chalk.yellow(`   ⚠️  Could not post inline comment for ${comment.path}:${comment.line}: ${err}`));
          failed++;
        }
      } finally {
        try { unlinkSync(tmpFile); } catch { /* ignore */ }
      }
    }

    console.log(chalk.green(`   ✅ Posted ${posted} comment(s)${failed > 0 ? `, ${failed} failed` : ''} on PR #${prNumber}`));
  }
}
