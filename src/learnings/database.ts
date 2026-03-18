// SQLite database lifecycle helpers for the learnings store.
// The DB is a derived artifact rebuilt from JSONL source files—never edit it directly.
// WAL files (.db-shm, .db-wal) are removed alongside the main file to avoid stale state.

import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { URL } from 'url';
import { LEARNINGS_DB_RELATIVE_PATH } from './paths.js';

/** Schema SQL is loaded once at module init and reused for every fresh database creation. */
const SCHEMA_SQL = fs.readFileSync(
  new URL('./schema.sql', import.meta.url),
  'utf8'
);

/** Returns the absolute path to the learnings SQLite database for the given repo root. */
export function getLearningsDbPath(repoPath: string): string {
  return path.join(path.resolve(repoPath), LEARNINGS_DB_RELATIVE_PATH);
}

/**
 * Deletes any existing database (including WAL/SHM files), creates a fresh one,
 * applies the schema, and returns the open connection.
 * Uses `DELETE` journal mode so no WAL files are created during the bulk rebuild.
 * Pass an explicit `dbPath` to write to a non-default location (e.g. a `.tmp` file).
 */
export function createFreshLearningsDatabase(
  repoPath: string,
  dbPath?: string
): Database.Database {
  const resolvedDbPath = dbPath ?? getLearningsDbPath(repoPath);
  removeLearningsDatabaseFiles(resolvedDbPath);

  fs.mkdirSync(path.dirname(resolvedDbPath), { recursive: true });
  const db = new Database(resolvedDbPath);
  sqliteVec.load(db);
  db.pragma('journal_mode = DELETE');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);

  return db;
}

/**
 * Opens an existing learnings database for reading or writing.
 * Throws a descriptive error (with the rebuild command) if the file does not exist.
 */
export function openLearningsDatabase(
  repoPath: string,
  options: { readonly?: boolean } = {}
): Database.Database {
  const dbPath = getLearningsDbPath(repoPath);
  if (!fs.existsSync(dbPath)) {
    throw new Error(
      `Missing ${dbPath}. Run "ivan learnings rebuild --repo ${path.resolve(repoPath)}" first.`
    );
  }

  const db = new Database(dbPath, {
    readonly: options.readonly ?? false,
    fileMustExist: true
  });
  sqliteVec.load(db);
  db.pragma('foreign_keys = ON');

  return db;
}

/** Removes the `.db`, `.db-shm`, and `.db-wal` files if they exist (safe to call when none are present). */
export function removeLearningsDatabaseFiles(dbPath: string): void {
  for (const candidate of [dbPath, `${dbPath}-shm`, `${dbPath}-wal`]) {
    if (fs.existsSync(candidate)) {
      fs.unlinkSync(candidate);
    }
  }
}
