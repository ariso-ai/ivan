// CLI handler for `ivan import-learnings <csv-file>`.
// Imports learnings from a CSV export into the canonical `.ivan/lessons.jsonl` file
// and rebuilds the derived SQLite database. Learning IDs are deterministic hashes of
// the statement text, so re-running the command on the same file is a no-op.

import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { parseCsv } from './csv.js';
import { createDeterministicId } from './id.js';
import { loadCanonicalRecords } from './parser.js';
import { writeLearningRecords } from './learning-writer.js';
import { rebuildLearningsDatabase } from './builder.js';
import {
  ensureLearningsDirectories,
  ensureCanonicalJsonlFiles,
  resolveLearningsRepositoryContext
} from './repository.js';
import { LESSONS_JSONL_RELATIVE_PATH } from './paths.js';
import type { LearningRecord } from './record-types.js';

interface ImportLearningsCommandOptions {
  repo?: string;
}

const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december'
];

/** Commander action handler: parses the CSV, merges new learnings, and rebuilds the DB. */
export async function runImportLearningsCommand(
  csvFile: string,
  options: ImportLearningsCommandOptions
): Promise<void> {
  const context = resolveLearningsRepositoryContext(
    options.repo ?? process.cwd()
  );
  const repoPath = context.repoPath;

  const csvPath = path.resolve(csvFile);
  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV file does not exist: ${csvPath}`);
  }

  const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'));
  if (rows.length < 2) {
    console.log(chalk.yellow('CSV file contains no data rows.'));
    return;
  }

  const imported = parseLearningRows(rows);
  console.log(
    chalk.blue(`📄 Parsed ${imported.length} learning(s) from ${csvPath}`)
  );

  ensureLearningsDirectories(context);
  ensureCanonicalJsonlFiles(repoPath);

  const existing = loadCanonicalRecords(repoPath).learnings;
  const existingIds = new Set(existing.map((record) => record.id));
  const existingStatements = new Set(
    existing.map((record) => normalizeStatement(record.statement))
  );

  const fresh: LearningRecord[] = [];
  for (const record of imported) {
    if (
      existingIds.has(record.id) ||
      existingStatements.has(normalizeStatement(record.statement))
    ) {
      continue;
    }
    existingIds.add(record.id);
    existingStatements.add(normalizeStatement(record.statement));
    fresh.push(record);
  }

  const skipped = imported.length - fresh.length;
  if (skipped > 0) {
    console.log(
      chalk.gray(`   Skipped ${skipped} already-imported learning(s)`)
    );
  }

  if (fresh.length === 0) {
    console.log(chalk.green('✅ No new learnings to import.'));
    return;
  }

  writeLearningRecords(repoPath, [...existing, ...fresh]);
  console.log(
    chalk.green(
      `✅ Added ${fresh.length} new learning(s) to ${LESSONS_JSONL_RELATIVE_PATH}`
    )
  );

  try {
    const result = await rebuildLearningsDatabase(repoPath);
    console.log(chalk.green('✅ Learnings database rebuilt'));
    console.log(chalk.gray(`   DB: ${result.dbPath}`));
    console.log(chalk.gray(`   Learnings: ${result.learningCount}`));
  } catch (err) {
    console.log(
      chalk.yellow(
        `⚠️  Learnings were written to ${LESSONS_JSONL_RELATIVE_PATH}, but the database rebuild failed: ${(err as Error).message}`
      )
    );
    console.log(
      chalk.yellow(
        `   Run "ivan learn rebuild --repo ${repoPath}" to rebuild it.`
      )
    );
  }
}

/**
 * Converts CSV rows (header + data) into `LearningRecord`s.
 * Expected columns (case-insensitive): Learning (required), File, URL,
 * Created At, Updated At. Unknown columns are ignored.
 */
function parseLearningRows(rows: string[][]): LearningRecord[] {
  const header = rows[0].map((column) => column.trim().toLowerCase());
  const learningIndex = header.indexOf('learning');
  if (learningIndex === -1) {
    throw new Error('CSV file must contain a "Learning" column');
  }

  const fileIndex = header.indexOf('file');
  const urlIndex = header.indexOf('url');
  const createdAtIndex = header.indexOf('created at');
  const updatedAtIndex = header.indexOf('updated at');

  const columnAt = (row: string[], index: number): string | undefined => {
    if (index === -1) return undefined;
    const value = row[index]?.trim();
    return value || undefined;
  };

  const records: LearningRecord[] = [];
  const seenIds = new Set<string>();

  for (const row of rows.slice(1)) {
    const statement = columnAt(row, learningIndex);
    if (!statement) {
      continue;
    }

    const id = createDeterministicId(
      'lrn',
      'csv-import',
      normalizeStatement(statement)
    );
    if (seenIds.has(id)) {
      continue;
    }
    seenIds.add(id);

    const fallbackTimestamp = new Date().toISOString();
    const createdAt =
      parseCsvTimestamp(columnAt(row, createdAtIndex)) ?? fallbackTimestamp;
    const updatedAt =
      parseCsvTimestamp(columnAt(row, updatedAtIndex)) ?? createdAt;
    const filePath = columnAt(row, fileIndex);
    const sourceUrl = columnAt(row, urlIndex);

    records.push({
      type: 'learning',
      sourcePath: LESSONS_JSONL_RELATIVE_PATH,
      id,
      kind: 'engineering_lesson',
      source_type: 'csv_import',
      statement,
      status: 'active',
      created_at: createdAt,
      updated_at: updatedAt,
      ...(filePath ? { applicability: `Applies to ${filePath}` } : {}),
      ...(sourceUrl ? { source_url: sourceUrl } : {})
    });
  }

  return records;
}

/** Whitespace-collapsed, lowercased statement used for both ID generation and dedup. */
function normalizeStatement(statement: string): string {
  return statement.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Parses timestamps like "June 27th 2026, 11:56:43 am" (the CSV export format)
 * into ISO strings, falling back to `Date` parsing. Returns undefined when unparseable.
 */
function parseCsvTimestamp(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const match = value
    .trim()
    .match(
      /^([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4}),?\s+(\d{1,2}):(\d{2}):(\d{2})\s*(am|pm)$/i
    );

  if (match) {
    const monthIndex = MONTH_NAMES.indexOf(match[1].toLowerCase());
    if (monthIndex !== -1) {
      let hours = parseInt(match[4], 10) % 12;
      if (match[7].toLowerCase() === 'pm') {
        hours += 12;
      }
      const date = new Date(
        parseInt(match[3], 10),
        monthIndex,
        parseInt(match[2], 10),
        hours,
        parseInt(match[5], 10),
        parseInt(match[6], 10)
      );
      return date.toISOString();
    }
  }

  const fallback = new Date(value);
  return Number.isNaN(fallback.getTime()) ? undefined : fallback.toISOString();
}
