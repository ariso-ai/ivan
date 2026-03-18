import { Kysely, sql } from 'kysely';
import BetterSqlite3 from 'better-sqlite3';
import chalk from 'chalk';
import type { Database as DatabaseSchema } from './types.js';
import { migrations, learningsMigrations } from './migrations/index.js';

export class MigrationManager {
  private db: Kysely<DatabaseSchema>;

  constructor(db: Kysely<DatabaseSchema>) {
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
          const statements = Array.isArray(migration.up)
            ? migration.up
            : [migration.up];
          for (const statement of statements) {
            await sql.raw(statement).execute(this.db);
          }
          await this.recordMigration(migration.id, migration.name);
          console.log(
            chalk.green(`✅ Migration ${migration.id}: ${migration.name}`)
          );
          ranCount++;
        } catch (error) {
          console.error(
            chalk.red(
              `❌ Failed to run migration ${migration.id}: ${migration.name}`
            )
          );
          console.error(
            chalk.red(
              `Error: ${error instanceof Error ? error.message : String(error)}`
            )
          );
          throw error;
        }
      } else {
        skippedCount++;
      }
    }

    if (ranCount > 0) {
      console.log(
        chalk.green(
          `✅ Database migrations completed (${ranCount} run, ${skippedCount} already applied)`
        )
      );
    } else {
      console.log(
        chalk.gray(
          `✅ Database up to date (${skippedCount} migrations already applied)`
        )
      );
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

  private async recordMigration(
    migrationId: number,
    name: string
  ): Promise<void> {
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

/**
 * Synchronous migration runner for the learnings SQLite database.
 * Uses raw better-sqlite3 (not Kysely) because the learnings DB requires the
 * sqlite-vec extension, which must be loaded before Kysely is initialized.
 */
export class LearningsMigrationManager {
  public quietMode: boolean = false;
  private db: BetterSqlite3.Database;

  constructor(db: BetterSqlite3.Database) {
    this.db = db;
  }

  runMigrations(): void {
    if (!this.quietMode) {
      console.log(chalk.blue('🔄 Running learnings database migrations...'));
    }

    this.createMigrationsTable();

    let ranCount = 0;
    let skippedCount = 0;

    for (const migration of learningsMigrations) {
      if (!this.hasMigrationRun(migration.id)) {
        try {
          const statements = Array.isArray(migration.up)
            ? migration.up
            : [migration.up];
          for (const statement of statements) {
            this.db.exec(statement);
          }
          this.recordMigration(migration.id, migration.name);
          if (!this.quietMode) {
            console.log(
              chalk.green(`✅ Migration ${migration.id}: ${migration.name}`)
            );
          }
          ranCount++;
        } catch (error) {
          console.error(
            chalk.red(
              `❌ Failed to run migration ${migration.id}: ${migration.name}`
            )
          );
          console.error(
            chalk.red(
              `Error: ${error instanceof Error ? error.message : String(error)}`
            )
          );
          throw error;
        }
      } else {
        skippedCount++;
      }
    }

    if (!this.quietMode) {
      if (ranCount > 0) {
        console.log(
          chalk.green(
            `✅ Learnings migrations completed (${ranCount} run, ${skippedCount} already applied)`
          )
        );
      } else {
        console.log(
          chalk.gray(
            `✅ Learnings database up to date (${skippedCount} migrations already applied)`
          )
        );
      }
    }
  }

  private createMigrationsTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        executed_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  private hasMigrationRun(migrationId: number): boolean {
    const row = this.db
      .prepare('SELECT id FROM migrations WHERE id = ?')
      .get(migrationId);
    return row !== undefined;
  }

  private recordMigration(migrationId: number, name: string): void {
    this.db
      .prepare('INSERT INTO migrations (id, name, executed_at) VALUES (?, ?, ?)')
      .run(migrationId, name, new Date().toISOString());
  }
}
