import { Kysely, SqliteDialect } from 'kysely';
import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import chalk from 'chalk';
import { Database as DatabaseSchema } from './types.js';
import { MigrationRunner } from './migration.js';
import { migrations } from './migrations/index.js';

export class DatabaseManager {
  private db: Kysely<DatabaseSchema>;
  private dbPath: string;

  constructor() {
    const ivanDir = path.join(os.homedir(), '.ivan');
    this.dbPath = path.join(ivanDir, 'db.sqlite');

    if (!fs.existsSync(ivanDir)) {
      fs.mkdirSync(ivanDir, { recursive: true });
    }

    const sqlite = new Database(this.dbPath);

    this.db = new Kysely<DatabaseSchema>({
      dialect: new SqliteDialect({
        database: sqlite
      })
    });
  }

  public async initialize(): Promise<void> {
    console.log(chalk.gray('🗄️  Initializing database...'));

    const dbExists = fs.existsSync(this.dbPath);
    if (!dbExists) {
      console.log(chalk.gray('📁 Creating database file...'));
    }

    await this.runMigrations();
    console.log(chalk.green('✓ Database initialized'));
  }

  private async runMigrations(): Promise<void> {
    const migrationRunner = new MigrationRunner(this.db);
    await migrationRunner.runMigrations(migrations);
  }

  public getDatabase(): Kysely<DatabaseSchema> {
    return this.db;
  }

  public async close(): Promise<void> {
    await this.db.destroy();
  }
}
