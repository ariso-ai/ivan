import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import path from 'path';
import os from 'os';
import * as sqliteVec from 'sqlite-vec';
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

    // Load sqlite-vec extension for vector similarity search
    sqliteVec.load(this.sqlite);

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

  executeVectorInsert(embedding: ArrayBuffer, learningId: number, text: string): void {
    const stmt = this.sqlite.prepare(`
      INSERT INTO learning_embeddings (embedding, learning_id, text)
      VALUES (?, ?, ?)
    `);
    stmt.run(embedding, learningId, text);
  }

  executeVectorSearch(embedding: ArrayBuffer, repositoryId: number, limit: number): Array<{
    learning_id: number;
    text: string;
    files: string;
    created_at: string;
    distance: number;
  }> {
    const stmt = this.sqlite.prepare(`
      SELECT
        le.learning_id,
        le.text,
        l.files,
        l.created_at,
        vec_distance_cosine(le.embedding, ?) as distance
      FROM learning_embeddings le
      INNER JOIN learnings l ON l.id = le.learning_id
      WHERE l.repository_id = ?
      ORDER BY distance ASC
      LIMIT ?
    `);
    return stmt.all(embedding, repositoryId, limit) as Array<{
      learning_id: number;
      text: string;
      files: string;
      created_at: string;
      distance: number;
    }>;
  }

  close(): void {
    this.sqlite.close();
  }
}