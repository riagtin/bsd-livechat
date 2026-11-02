// SPDX-License-Identifier: AGPL-3.0-only
import { config } from '../config/index.js';
import { MemoryDatabase } from './memory.js';
import { PostgresDatabase } from './postgres.js';
import { IDatabase } from './types.js';

let activeDatabase: IDatabase;

export async function initDatabase(): Promise<IDatabase> {
  if (config.db.driver === 'postgres') {
    try {
      const pgDb = new PostgresDatabase();
      await pgDb.init();
      activeDatabase = pgDb;
      console.log('✅ [Database] Production PostgreSQL driver active.');
      return activeDatabase;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `⚠️ [Database] Could not connect to PostgreSQL (${msg}). Falling back to MemoryDatabase.`
      );
      const memDb = new MemoryDatabase();
      await memDb.init();
      activeDatabase = memDb;
      return activeDatabase;
    }
  }

  // Default: In-Memory
  const memDb = new MemoryDatabase();
  await memDb.init();
  activeDatabase = memDb;
  return activeDatabase;
}

export function getDatabase(): IDatabase {
  if (!activeDatabase) {
    activeDatabase = new MemoryDatabase();
  }
  return activeDatabase;
}

export * from './types.js';
