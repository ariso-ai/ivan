import Database from 'better-sqlite3';
import chalk from 'chalk';
import { learningsMigrations } from '../database/migrations/index.js';

export class LearningsMigrationManager {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  runMigrations(): void {
    console.error(chalk.blue('🔄 Running learnings database migrations...'));

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
          console.error(
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
      console.error(
        chalk.green(
          `✅ Learnings migrations completed (${ranCount} run, ${skippedCount} already applied)`
        )
      );
    } else {
      console.error(
        chalk.gray(
          `✅ Learnings database up to date (${skippedCount} migrations already applied)`
        )
      );
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
