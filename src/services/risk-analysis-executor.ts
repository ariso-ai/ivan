import chalk from 'chalk';
import { ExecutorFactory } from './executor-factory.js';
import type { IClaudeExecutor } from './executor-factory.js';
import { createRepositoryManager } from './service-factory.js';
import type { IRepositoryManager } from './git-interfaces.js';
import { claudeSpinner } from './interjection-manager.js';

const RISK_ANALYSIS_SYSTEM_PROMPT = `You are a principal engineer performing a pre-deployment risk analysis of a set of proposed changes.

Your job is NOT to review code style or suggest improvements — it is to identify what could go wrong when these changes ship, how likely that is, how bad the blast radius would be, and what mitigations should be in place before rollout.

For every risk you identify:
- State the specific failure mode (what breaks, for whom, and when)
- Rate its likelihood (low / medium / high) and impact (low / medium / high / critical)
- Note whether it is roll-backable, and what the rollback path is
- Recommend a concrete mitigation (guard, feature flag, deploy ordering, backup, monitoring, etc.)

Ground your analysis in the actual repository: use your tools to read the code, migrations, and configuration that the described changes would touch. Do not speculate about code you have not looked at — if a change references something you cannot find in the repo, say so explicitly rather than guessing.

Be direct and specific. If an area carries no meaningful risk, say so briefly and move on.`;

interface RiskDimension {
  key: string;
  label: string;
  prompt: string;
}

const RISK_DIMENSIONS: RiskDimension[] = [
  {
    key: 'db-migration',
    label: 'Analyze DB migration risk',
    prompt: `Analyze the DATABASE MIGRATION risk of the proposed changes.

Focus on:
- Schema changes: dropped/renamed columns or tables, type changes, and whether old code running during the deploy window would break against the new schema (and vice versa)
- Destructive or irreversible operations: data loss potential, and whether a down-migration actually restores state
- Locking and downtime: long-running ALTERs, index builds on large tables (are indexes created concurrently?), table rewrites, migrations that block reads or writes
- Backfills and data transformations: volume, batching, idempotency if interrupted midway
- Deploy ordering: does the migration need to run before or after the code deploy, and what happens if that ordering is violated
- Rollback: can the migration be reverted safely once new data has been written

If the changes involve no database migrations, state that clearly and rate this dimension as no risk.`
  },
  {
    key: 'infra-security',
    label: 'Analyze infra/security risk',
    prompt: `Analyze the INFRASTRUCTURE and SECURITY risk of the proposed changes.

Focus on:
- Security: new or widened endpoint exposure, authentication/authorization changes, secrets or credentials in code or config, injection surfaces, permission/IAM scope changes, sensitive data logging or exposure
- Dependencies: new or upgraded packages, known-vulnerable versions, supply-chain surface
- Infrastructure/config: environment variable changes, CI/CD workflow changes, networking or firewall implications, resource limits, quota or cost blowups
- Availability: single points of failure introduced, changes to health checks, restarts or reprovisioning required by the rollout
- Blast radius: if this change misbehaves, what else does it take down

If the changes touch no infrastructure or security surface, state that clearly and rate this dimension as no risk.`
  },
  {
    key: 'backend-service',
    label: 'Analyze backend service risk',
    prompt: `Analyze the BACKEND SERVICE risk of the proposed changes.

Focus on:
- API contract changes: breaking request/response shape changes, removed or renamed fields, status code changes, and impact on existing clients
- Backwards compatibility: can old and new versions of the service run side by side during rollout
- Error handling: new failure paths, unhandled promise rejections or exceptions, retry storms, timeout behavior
- Performance: N+1 queries, unbounded loops or payloads, memory growth, hot-path latency regressions
- State and concurrency: race conditions, transactional integrity, idempotency of mutating endpoints
- Third-party integrations: changed assumptions about external services, rate limits, degraded-mode behavior

If the changes do not touch backend service code, state that clearly and rate this dimension as no risk.`
  },
  {
    key: 'worker-frontend',
    label: 'Analyze worker/frontend risk',
    prompt: `Analyze the WORKER (background job) and FRONTEND risk of the proposed changes.

For workers/background jobs, focus on:
- Queue and job semantics: changed job payloads breaking in-flight jobs, retry and dead-letter behavior, idempotency of re-run jobs
- Scheduling: cron or interval changes, overlap of long-running jobs, thundering-herd effects
- Failure isolation: does a failing job poison the queue or block other work

For frontend/client code, focus on:
- Client-server compatibility: cached/stale frontend bundles calling changed APIs during and after deploy
- Breaking UX flows: removed or renamed routes, changed form contracts, state management regressions
- Caching: CDN/browser cache invalidation, localStorage/session schema changes breaking returning users
- Error surfaces: unhandled rejections that blank the page vs. degrade gracefully

If the changes touch neither workers nor frontend code, state that clearly and rate this dimension as no risk.`
  }
];

function buildChangesSection(changes: string[]): string {
  const list = changes.map((c, i) => `${i + 1}. ${c}`).join('\n');
  return `## Proposed changes under analysis

${list}`;
}

export class RiskAnalysisExecutor {
  private claudeExecutor: IClaudeExecutor;
  private repositoryManager: IRepositoryManager;

  constructor() {
    this.claudeExecutor = ExecutorFactory.getExecutor();
    this.repositoryManager = createRepositoryManager();
  }

  async executeRiskAnalysis(changes: string[]): Promise<void> {
    try {
      await this.claudeExecutor.validateClaudeCodeInstallation();
      console.log(chalk.green('✅ Claude Code configured'));

      const workingDir =
        await this.repositoryManager.getValidWorkingDirectory();
      const repoInfo = this.repositoryManager.getRepositoryInfo(workingDir);
      console.log(chalk.blue(`📂 Working in: ${repoInfo.name}`));
      console.log('');

      console.log(chalk.blue.bold('🛡️  Running risk analysis'));
      for (const [i, change] of changes.entries()) {
        console.log(chalk.gray(`   ${i + 1}. ${change}`));
      }
      console.log('');

      // Suppress the executor's per-turn logging so the tree output stays readable
      this.claudeExecutor.quietMode = true;

      const changesSection = buildChangesSection(changes);

      // Run all dimensions concurrently. Individual per-dimension spinners
      // aren't used here since ora/InterjectionManager only support a single
      // active spinner at a time — a batch spinner covers the parallel work.
      const batchSpinner = claudeSpinner(
        `Analyzing ${RISK_DIMENSIONS.length} risk dimensions in parallel`
      ).start();

      let dimensionResults: Array<{ label: string; analysis: string }>;
      try {
        dimensionResults = await Promise.all(
          RISK_DIMENSIONS.map(async (dimension) => {
            const result = await this.claudeExecutor.executeTurn(
              `${changesSection}\n\n${dimension.prompt}`,
              workingDir,
              {
                systemPrompt: RISK_ANALYSIS_SYSTEM_PROMPT,
                readOnly: true,
                permissionMode: 'plan'
              }
            );
            return { label: dimension.label, analysis: result.lastMessage };
          })
        );
        batchSpinner.succeed(
          `Completed ${RISK_DIMENSIONS.length} risk dimension analyses`
        );
        for (const { label } of dimensionResults) {
          console.log(chalk.gray(`   ✔ ${label}`));
        }
      } catch (err) {
        batchSpinner.fail('Risk dimension analysis failed');
        throw err;
      }

      const synthesisSpinner = claudeSpinner(
        'Synthesizing final risk analysis'
      ).start();
      let finalReport: string;
      try {
        finalReport = await this.synthesize(
          changes,
          dimensionResults,
          workingDir
        );
        synthesisSpinner.succeed('Final risk analysis ready');
      } catch (err) {
        synthesisSpinner.fail('Failed to synthesize final risk analysis');
        throw err;
      }

      console.log('');
      console.log(chalk.blue.bold('📋 Final Risk Analysis'));
      console.log(chalk.gray('─'.repeat(60)));
      console.log(finalReport);
    } finally {
      this.repositoryManager.close();
    }
  }

  private async synthesize(
    changes: string[],
    dimensionResults: Array<{ label: string; analysis: string }>,
    workingDir: string
  ): Promise<string> {
    const findings = dimensionResults
      .map((r) => `### ${r.label}\n\n${r.analysis}`)
      .join('\n\n');

    const synthesisPrompt = `${buildChangesSection(changes)}

Four specialist risk analyses have already been performed against these changes. Their findings are below.

${findings}

Synthesize these into ONE final risk analysis report. Do not re-investigate the code — work from the findings above. Structure the report as:

1. **Overall risk rating** — one of: NONE / LOW / MEDIUM / HIGH / CRITICAL, with a one-sentence justification
2. **Risk summary by area** — a table with columns: Area (DB migration, Infra/security, Backend service, Worker/frontend), Risk level, Key concern
3. **Top risks** — the most important risks across all areas, ordered by severity, each with its failure mode, likelihood/impact, and mitigation
4. **Required mitigations before rollout** — a concrete pre-deploy checklist derived from the findings
5. **Rollback plan** — how to revert if things go wrong, noting anything that is NOT cleanly reversible

Deduplicate risks that multiple analyses flagged, and drop dimensions that reported no risk (mention them only in the summary table). Your final message must be the complete report and nothing else.`;

    const result = await this.claudeExecutor.executeTurn(
      synthesisPrompt,
      workingDir,
      {
        systemPrompt: RISK_ANALYSIS_SYSTEM_PROMPT,
        readOnly: true,
        permissionMode: 'plan'
      }
    );

    return result.lastMessage;
  }
}
