import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { applySchema } from './schema.ts';

/**
 * Opens (and if needed creates) the SQLite database and applies the schema.
 * `':memory:'` gives a private in-memory database (tests).
 */
export function openDatabase(file: string): DatabaseSync {
  const inMemory = file === ':memory:';
  if (!inMemory) mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  if (!inMemory) db.exec('PRAGMA journal_mode = WAL');
  applySchema(db);
  return db;
}
