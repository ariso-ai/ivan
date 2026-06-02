// CLI handler for `ivan learn coding-sessions`.
// Orchestrates the full pipeline: parse → analyze → store → rebuild.

import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs';
import path from 'path';
import {
  discoverSessionFiles,
  parseSessionFile,
  type SessionDigest
} from './session-parser.js';
import { SessionAnalyzer, type SessionAnalysis } from './session-analyzer.js';
import { writeLearningRecords } from './learning-writer.js';
import { rebuildLearningsDatabase } from './builder.js';
import { loadCanonicalRecords } from './parser.js';
import { resolveCanonicalLearningsPath } from './paths.js';
import {
  ensureLearningsDirectories,
  resolveLearningsRepositoryContext
} from './repository.js';
import { DatabaseManager } from '../database.js';

interface CodingSessionsOptions {
  repo: string;
  project?: string;
  recent?: string;
  dryRun?: boolean;
  force?: boolean;
  reset?: boolean;
}

/** Commander action handler for `ivan learn coding-sessions`. */
export async function runCodingSessionsCommand(
  options: CodingSessionsOptions
): Promise<void> {
  const repoPath = path.resolve(options.repo);

  if (options.reset) {
    await handleReset(repoPath);
    return;
  }

  // Ensure .ivan/ directory and learnings DB exist
  const context = resolveLearningsRepositoryContext(repoPath);
  ensureLearningsDirectories(context);

  // Run main DB migrations for session_analyses table
  const dbManager = new DatabaseManager();
  await dbManager.runMigrations();

  try {
    // Stage 1: Discover and parse sessions
    const spinner = ora('Discovering Claude Code sessions...').start();

    const sessionFiles = discoverSessionFiles({
      project: options.project,
      recentDays: options.recent ? parseInt(options.recent) : undefined
    });

    spinner.succeed(
      `Found ${sessionFiles.length} session files${options.project ? ` (project: ${options.project})` : ''}`
    );

    if (sessionFiles.length === 0) {
      console.log(chalk.yellow('No sessions found to analyze.'));
      return;
    }

    // Check which sessions are already analyzed (unless --force)
    // Uses composite key (session_id|file_size|mtime) so modified transcripts get re-analyzed
    const alreadyAnalyzed = options.force
      ? new Map<string, { fileSize: number; fileModifiedAt: string }>()
      : loadAnalyzedSessions(dbManager);

    // Parse sessions
    const parseSpinner = ora('Parsing session transcripts...').start();
    const digests: SessionDigest[] = [];
    let skippedAlready = 0;
    let skippedLowSignal = 0;

    for (const file of sessionFiles) {
      const cached = alreadyAnalyzed.get(file.sessionId);
      if (cached) {
        const stat = fs.statSync(file.filePath);
        if (
          cached.fileSize === stat.size &&
          cached.fileModifiedAt === stat.mtime.toISOString()
        ) {
          skippedAlready++;
          continue;
        }
      }

      try {
        const digest = await parseSessionFile(
          file.filePath,
          file.projectPath,
          file.sessionId
        );
        if (digest) {
          digests.push(digest);
        } else {
          skippedLowSignal++;
        }
      } catch {
        // Skip unparseable sessions
        skippedLowSignal++;
      }
    }

    parseSpinner.succeed(
      `Parsed ${digests.length} qualifying sessions (${skippedAlready} cached, ${skippedLowSignal} low-signal)`
    );

    if (digests.length === 0) {
      if (skippedAlready > 0) {
        console.log(
          chalk.green('All sessions already analyzed. Nothing to do.')
        );
      } else {
        console.log(
          chalk.yellow(
            'No sessions with sufficient signal to analyze (all filtered as low-signal).'
          )
        );
      }
      return;
    }

    // Dry run: show what would be analyzed
    if (options.dryRun) {
      console.log('');
      console.log(
        chalk.blue.bold('Dry run — sessions that would be analyzed:')
      );
      console.log('');
      for (const d of digests) {
        const title = d.aiTitle ?? 'Untitled';
        const proj = extractProjectName(d.projectPath);
        console.log(
          `  ${chalk.cyan(proj)} ${chalk.white(title)} (${d.userMessages.length} user msgs, correction density: ${(d.dynamics.correctionDensity * 100).toFixed(0)}%)`
        );
      }
      console.log('');
      console.log(`Total: ${digests.length} sessions would be sent to GPT-5.5`);
      return;
    }

    // Stage 2: Analyze with GPT-5.5
    const analyzer = new SessionAnalyzer();
    const analysisResults: Array<{
      analysis: SessionAnalysis;
      digest: SessionDigest;
    }> = [];
    let totalPatterns = 0;
    let totalExamples = 0;

    console.log('');
    const analyzeSpinner = ora(
      `Analyzing session 1/${digests.length} with GPT-5.5...`
    ).start();

    for (let i = 0; i < digests.length; i++) {
      const digest = digests[i];
      analyzeSpinner.text = `Analyzing session ${i + 1}/${digests.length}: ${digest.aiTitle ?? 'Untitled'}`;

      try {
        const analysis = await analyzer.analyzeSession(digest);
        analysisResults.push({ analysis, digest });
        totalPatterns += analysis.patterns.length;
        totalExamples += analysis.exampleInteractions.length;

        // Track in main DB
        saveSessionAnalysis(dbManager, digest, analysis);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        analyzeSpinner.warn(
          `Failed to analyze session ${digest.sessionId}: ${msg}`
        );
        analyzeSpinner.start();
      }
    }

    analyzeSpinner.succeed(
      `Analyzed ${analysisResults.length} sessions: ${totalPatterns} thinking patterns, ${totalExamples} example interactions`
    );

    if (totalPatterns === 0 && totalExamples === 0) {
      console.log(
        chalk.yellow('No thinking patterns or example interactions found.')
      );
      return;
    }

    // Stage 3: Store as learning records
    const storeSpinner = ora('Storing patterns and examples...').start();

    // Convert analyses to learning records (paired to avoid index misalignment)
    const newRecords = analysisResults.flatMap(({ analysis, digest }) =>
      analyzer.analysisToLearningRecords(analysis, digest)
    );

    // Merge: keep all existing records except those being replaced by new ones
    const newRecordIds = new Set(newRecords.map((r) => r.id));
    const existingRecords = loadExistingRecords(repoPath, newRecordIds);
    const mergedRecords = [...existingRecords, ...newRecords];

    writeLearningRecords(repoPath, mergedRecords);
    storeSpinner.succeed(
      `Stored ${newRecords.length} thinking patterns (${mergedRecords.length} total learnings)`
    );

    // Stage 4: Rebuild SQLite with embeddings
    const rebuildSpinner = ora(
      'Rebuilding database with embeddings...'
    ).start();
    try {
      const result = await rebuildLearningsDatabase(repoPath);
      rebuildSpinner.succeed(
        `Database rebuilt: ${result.learningCount} learnings, ${result.embeddingsGenerated} new embeddings`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      rebuildSpinner.fail(`Rebuild failed: ${msg}`);
      return;
    }

    // Summary (only on full success)
    console.log('');
    console.log(chalk.green.bold('Coding sessions analysis complete'));
    printPatternSummary(analysisResults.map((r) => r.analysis));
  } finally {
    dbManager.close();
  }
}

/**
 * Reads existing learning records, excluding any whose ID is in `replaceIds`.
 * This preserves both PR-derived records AND previously cached session-derived
 * records from earlier runs, only replacing records that were just re-generated.
 */
function loadExistingRecords(repoPath: string, replaceIds: Set<string>) {
  const filePath = resolveCanonicalLearningsPath(
    path.resolve(repoPath),
    'lessons.jsonl'
  );

  if (!fs.existsSync(filePath)) return [];

  const dataset = loadCanonicalRecords(repoPath);
  return dataset.learnings.filter((r) => !replaceIds.has(r.id));
}

function loadAnalyzedSessions(
  dbManager: DatabaseManager
): Map<string, { fileSize: number; fileModifiedAt: string }> {
  try {
    const db = dbManager.getDatabase();
    const rows = db
      .prepare(
        'SELECT session_id, file_size, file_modified_at FROM session_analyses'
      )
      .all() as Array<{
      session_id: string;
      file_size: number;
      file_modified_at: string;
    }>;
    const map = new Map<string, { fileSize: number; fileModifiedAt: string }>();
    for (const r of rows) {
      map.set(r.session_id, {
        fileSize: r.file_size,
        fileModifiedAt: r.file_modified_at
      });
    }
    return map;
  } catch {
    return new Map();
  }
}

function saveSessionAnalysis(
  dbManager: DatabaseManager,
  digest: SessionDigest,
  analysis: SessionAnalysis
): void {
  try {
    // Redact user_message from example interactions before persisting
    const sanitizedAnalysis = {
      ...analysis,
      exampleInteractions: analysis.exampleInteractions.map((e) => ({
        context: e.context,
        derived_question: e.derived_question,
        when_to_ask: e.when_to_ask,
        confidence: e.confidence
      }))
    };

    const db = dbManager.getDatabase();
    db.prepare(
      `INSERT OR REPLACE INTO session_analyses
       (session_id, project_path, file_path, file_size, file_modified_at,
        ai_title, session_timestamp, pattern_count, analysis_json, analyzed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      digest.sessionId,
      digest.projectPath,
      digest.filePath,
      digest.fileSize,
      digest.fileModifiedAt,
      digest.aiTitle,
      digest.timestamp,
      analysis.patterns.length,
      JSON.stringify(sanitizedAnalysis),
      new Date().toISOString()
    );
  } catch {
    // Non-critical — continue even if tracking fails
  }
}

function extractProjectName(projectPath: string): string {
  // Convert "-Users-erkang-Repos-ariso-agents" to "agents"
  const parts = projectPath.split('-').filter(Boolean);
  return parts[parts.length - 1] ?? projectPath;
}

function printPatternSummary(analyses: SessionAnalysis[]): void {
  const byKind: Record<string, number> = {};
  let exampleCount = 0;

  for (const analysis of analyses) {
    for (const pattern of analysis.patterns) {
      byKind[pattern.kind] = (byKind[pattern.kind] ?? 0) + 1;
    }
    exampleCount += analysis.exampleInteractions.length;
  }

  if (Object.keys(byKind).length === 0 && exampleCount === 0) return;

  const labels: Record<string, string> = {
    thinking_architecture: 'Architecture',
    thinking_product: 'Product & UX',
    thinking_quality: 'Quality & Debugging',
    thinking_process: 'Process & Decisions'
  };

  if (Object.keys(byKind).length > 0) {
    console.log(chalk.blue('Thinking patterns:'));
    for (const [kind, count] of Object.entries(byKind).sort(
      (a, b) => b[1] - a[1]
    )) {
      console.log(`  ${labels[kind] ?? kind}: ${count}`);
    }
  }

  if (exampleCount > 0) {
    console.log(chalk.blue(`Example interactions: ${exampleCount}`));
  }
}

async function handleReset(repoPath: string): Promise<void> {
  // Remove session-derived records from lessons.jsonl
  const filePath = resolveCanonicalLearningsPath(
    path.resolve(repoPath),
    'lessons.jsonl'
  );

  if (fs.existsSync(filePath)) {
    const dataset = loadCanonicalRecords(repoPath);
    const nonSessionRecords = dataset.learnings.filter(
      (r) => r.source_type !== 'coding_session'
    );
    writeLearningRecords(repoPath, nonSessionRecords);
    console.log(
      chalk.green(
        `Removed session-derived learnings. ${nonSessionRecords.length} PR-derived learnings preserved.`
      )
    );
  }

  // Clear session_analyses table
  const dbManager = new DatabaseManager();
  try {
    await dbManager.runMigrations();
    const db = dbManager.getDatabase();
    db.prepare('DELETE FROM session_analyses').run();
    console.log(chalk.green('Cleared session analysis cache.'));
  } catch {
    // Table might not exist yet
  } finally {
    dbManager.close();
  }

  // Rebuild
  try {
    await rebuildLearningsDatabase(repoPath);
    console.log(chalk.green('Database rebuilt.'));
  } catch {
    // OK if rebuild fails
  }
}
