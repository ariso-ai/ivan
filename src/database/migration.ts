import { Kysely } from 'kysely';

export interface Migration {
  id: string;
  name: string;
  up: (db: Kysely<any>) => Promise<void>;
  down: (db: Kysely<any>) => Promise<void>;
}

export class MigrationRunner {
  private db: Kysely<any>;

  constructor(db: Kysely<any>) {
    this.db = db;
  }

  public async runMigrations(migrations: Migration[]): Promise<void> {
    await this.createMigrationsTable();

    for (const migration of migrations) {
      const exists = await this.migrationExists(migration.id);
      if (!exists) {
        await migration.up(this.db);
        await this.recordMigration(migration.id, migration.name);
      }
    }
  }

  private async createMigrationsTable(): Promise<void> {
    await this.db.schema
      .createTable('migrations')
      .ifNotExists()
      .addColumn('id', 'text', (col) => col.primaryKey())
      .addColumn('name', 'text', (col) => col.notNull())
      .addColumn('executed_at', 'text', (col) => col.notNull().defaultTo('CURRENT_TIMESTAMP'))
      .execute();
  }

  private async migrationExists(id: string): Promise<boolean> {
    const result = await this.db
      .selectFrom('migrations')
      .where('id', '=', id)
      .selectAll()
      .executeTakeFirst();

    return !!result;
  }

  private async recordMigration(id: string, name: string): Promise<void> {
    await this.db
      .insertInto('migrations')
      .values({
        id,
        name,
        executed_at: new Date().toISOString()
      })
      .execute();
  }
}
