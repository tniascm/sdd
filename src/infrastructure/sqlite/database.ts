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
  // FR-019 / R-2: deleted content is overwritten with zeros, not left in free space.
  db.exec('PRAGMA secure_delete = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  if (!inMemory) db.exec('PRAGMA journal_mode = WAL');
  applySchema(db);
  return db;
}
