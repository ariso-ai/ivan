import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { URL } from 'url';

const SCHEMA_SQL = fs.readFileSync(
  new URL('./schema.sql', import.meta.url),
  'utf8'
);

export function getLearningsDbPath(repoPath: string): string {
  return path.join(path.resolve(repoPath), 'learnings.db');
}

export function createFreshLearningsDatabase(
  repoPath: string
): Database.Database {
  const dbPath = getLearningsDbPath(repoPath);
  removeLearningsDatabaseFiles(dbPath);

  const db = new Database(dbPath);
  db.pragma('journal_mode = DELETE');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);

  return db;
}

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
  db.pragma('foreign_keys = ON');

  return db;
}

export function removeLearningsDatabaseFiles(dbPath: string): void {
  for (const candidate of [dbPath, `${dbPath}-shm`, `${dbPath}-wal`]) {
    if (fs.existsSync(candidate)) {
      fs.unlinkSync(candidate);
    }
  }
}
