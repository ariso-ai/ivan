import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import path from 'path';
import os from 'os';
import { Database as DatabaseSchema } from './database/types.js';
import { MigrationManager } from './database/migration.js';

export * from './database/types.js';

export class DatabaseManager {
  private sqlite: Database.Database;
  private db: Kysely<DatabaseSchema>;
  private dbPath: string;

  constructor() {
    this.dbPath = path.join(os.homedir(), '.ivan', 'db.sqlite');
    this.sqlite = new Database(this.dbPath);
    this.sqlite.pragma('journal_mode = WAL');
    
    this.db = new Kysely<DatabaseSchema>({
      dialect: new SqliteDialect({
        database: this.sqlite,
      }),
    });
  }

  async runMigrations(): Promise<void> {
    const migrationManager = new MigrationManager(this.db);
    await migrationManager.runMigrations();
  }

  getKysely(): Kysely<DatabaseSchema> {
    return this.db;
  }

  close(): void {
    this.sqlite.close();
  }
}