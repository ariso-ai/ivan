declare module 'sqlite-vec' {
  import type Database from 'better-sqlite3';

  export function load(database: Database): void;
}
