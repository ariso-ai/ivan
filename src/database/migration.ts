import { Kysely, sql } from 'kysely';
import chalk from 'chalk';
import { Database } from './types.js';
import { migrations } from './migrations/index.js';

export class MigrationManager {
  private db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.db = db;
  }

  async runMigrations(): Promise<void> {
    console.log(chalk.blue('🔄 Running database migrations...'));

    await this.createMigrationsTable();

    let ranCount = 0;
    let skippedCount = 0;

    for (const migration of migrations) {
      if (!(await this.hasMigrationRun(migration.id))) {
        try {
          const statements = Array.isArray(migration.up) ? migration.up : [migration.up];
          for (const statement of statements) {
            await sql.raw(statement).execute(this.db);
          }
          await this.recordMigration(migration.id, migration.name);
          console.log(chalk.green(`✅ Migration ${migration.id}: ${migration.name}`));
          ranCount++;
        } catch (error) {
          console.error(chalk.red(`❌ Failed to run migration ${migration.id}: ${migration.name}`));
          console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
          throw error;
        }
      } else {
        skippedCount++;
      }
    }

    if (ranCount > 0) {
      console.log(chalk.green(`✅ Database migrations completed (${ranCount} run, ${skippedCount} already applied)`));
    } else {
      console.log(chalk.gray(`✅ Database up to date (${skippedCount} migrations already applied)`));
    }
  }

  private async createMigrationsTable(): Promise<void> {
    const migrationsSql = `
      CREATE TABLE IF NOT EXISTS migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        executed_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;
    await sql.raw(migrationsSql).execute(this.db);
  }

  private async hasMigrationRun(migrationId: number): Promise<boolean> {
    try {
      const result = await this.db
        .selectFrom('migrations')
        .select('id')
        .where('id', '=', migrationId)
        .executeTakeFirst();

      return result !== undefined;
    } catch {
      return false;
    }
  }

  private async recordMigration(migrationId: number, name: string): Promise<void> {
    await this.db
      .insertInto('migrations')
      .values({
        id: migrationId,
        name,
        executed_at: new Date().toISOString()
      })
      .execute();
  }
}
