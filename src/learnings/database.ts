// SQLite database lifecycle helpers for the learnings store.
// The DB is a derived artifact rebuilt from JSONL source files—never edit it directly.
// WAL files (.db-shm, .db-wal) are removed alongside the main file to avoid stale state.

import fs from 'fs';
import path from 'path';
import BetterSqlite3 from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import * as sqliteVec from 'sqlite-vec';
import { LEARNINGS_DB_RELATIVE_PATH } from './paths.js';
import { MigrationManager } from '../database/migration.js';
import { learningsMigrations } from '../database/migrations/index.js';

/** Kysely schema type for the learnings SQLite database. */
export interface LearningsDatabase {
  evidence: {
    id: string;
    source_system: string;
    source_type: string;
    external_url: string | null;
    parent_url: string | null;
    author_type: string | null;
    author_name: string | null;
    occurred_at: string | null;
    base_weight: number | null;
    final_weight: number | null;
    boosts_json: string | null;
    penalties_json: string | null;
    created_at: string;
    updated_at: string;
  };
  learnings: {
    id: string;
    kind: string;
    source_type: string | null;
    title: string | null;
    statement: string;
    rationale: string | null;
    applicability: string | null;
    confidence: number | null;
    status: string;
    created_at: string;
    updated_at: string;
  };
  learning_evidence: {
    learning_id: string;
    evidence_id: string;
    relationship_type: string;
    contribution_weight: number | null;
    extraction_reason: string | null;
    created_at: string;
  };
  learning_tags: {
    learning_id: string;
    tag: string;
    source: string;
    weight: number | null;
    created_at: string;
  };
  meta: {
    key: string;
    value: string;
    updated_at: string;
  };
  migrations: {
    id: number;
    name: string;
    executed_at: string;
  };
}

/** Returns the absolute path to the learnings SQLite database for the given repo root. */
export function getLearningsDbPath(repoPath: string): string {
  return path.join(path.resolve(repoPath), LEARNINGS_DB_RELATIVE_PATH);
}

/**
 * Deletes any existing database (including WAL/SHM files), creates a fresh one,
 * applies migrations, and returns an open Kysely connection.
 * Uses `DELETE` journal mode so no WAL files are created during the bulk rebuild.
 * Pass an explicit `dbPath` to write to a non-default location (e.g. a `.tmp` file).
 */
export async function createFreshLearningsDatabase(
  repoPath: string,
  dbPath?: string
): Promise<Kysely<LearningsDatabase>> {
  const resolvedDbPath = dbPath ?? getLearningsDbPath(repoPath);
  removeLearningsDatabaseFiles(resolvedDbPath);

  fs.mkdirSync(path.dirname(resolvedDbPath), { recursive: true });
  const sqlite = new BetterSqlite3(resolvedDbPath);
  sqliteVec.load(sqlite);
  sqlite.pragma('journal_mode = DELETE');
  sqlite.pragma('foreign_keys = ON');

  const db = new Kysely<LearningsDatabase>({
    dialect: new SqliteDialect({ database: sqlite })
  });
  await new MigrationManager(db, learningsMigrations).runMigrations();
  return db;
}

/**
 * Opens an existing learnings database for reading or writing.
 * Throws a descriptive error (with the rebuild command) if the file does not exist.
 */
export function openLearningsDatabase(
  repoPath: string,
  options: { readonly?: boolean } = {}
): Kysely<LearningsDatabase> {
  const dbPath = getLearningsDbPath(repoPath);
  if (!fs.existsSync(dbPath)) {
    throw new Error(
      `Missing ${dbPath}. Run "ivan learnings rebuild --repo ${path.resolve(repoPath)}" first.`
    );
  }

  const sqlite = new BetterSqlite3(dbPath, {
    readonly: options.readonly ?? false,
    fileMustExist: true
  });
  sqliteVec.load(sqlite);
  sqlite.pragma('foreign_keys = ON');

  return new Kysely<LearningsDatabase>({
    dialect: new SqliteDialect({ database: sqlite })
  });
}

/** Removes the `.db`, `.db-shm`, and `.db-wal` files if they exist (safe to call when none are present). */
function removeLearningsDatabaseFiles(dbPath: string): void {
  for (const candidate of [dbPath, `${dbPath}-shm`, `${dbPath}-wal`]) {
    if (fs.existsSync(candidate)) {
      fs.unlinkSync(candidate);
    }
  }
}
