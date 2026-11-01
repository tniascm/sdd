// N-1 / issue #1 — FR-019 (amended), research R15: the erasure checkpoint must not block other
// requests while another connection reads, and must clean the write-ahead log once it can.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it } from 'vitest';
import { startHarness, PASSWORD, type Harness } from '../support/harness.ts';
import { openDatabase } from '../../src/infrastructure/sqlite/database.ts';
import { SqliteStorageFlusher } from '../../src/infrastructure/sqlite/storage-flusher.ts';

const EMAIL = 'n1.reader@uni.example';
const NAME = 'Nora Readername';

let h: Harness | undefined;
let reader: DatabaseSync | undefined;
let dir: string | undefined;

afterEach(() => {
  if (reader?.isOpen) reader.close();
  h?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
  h = reader = dir = undefined;
});

function walContainsPersonalData(dbFile: string): boolean {
  const wal = `${dbFile}-wal`;
  if (!existsSync(wal)) return false;
  const bytes = readFileSync(wal);
  return bytes.includes(Buffer.from(EMAIL)) || bytes.includes(Buffer.from(NAME));
}

async function waitFor(condition: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return condition();
}

async function eraseWhileAnotherConnectionReads() {
  dir = mkdtempSync(join(tmpdir(), 'roombook-n1-'));
  const dbFile = join(dir, 'n1.db');
  h = await startHarness({ dbFile });
  const user = await h.newUser({ email: EMAIL, displayName: NAME });

  // A second connection (e.g. a backup) holds a read snapshot.
  reader = new DatabaseSync(dbFile);
  reader.exec('BEGIN');
  reader.prepare('SELECT count(*) AS n FROM users').get();

  const started = performance.now();
  const res = await user.api.post('/me/erase', { password: PASSWORD });
  return { dbFile, res, elapsedMs: performance.now() - started };
}

it('N-1: account erasure does not block while another connection is reading', async () => {
  const { res, elapsedMs } = await eraseWhileAnotherConnectionReads();
  expect(res.status).toBe(204);
  expect(elapsedMs).toBeLessThan(1000);
}, 15_000);

it('N-1: once the reader finishes, the write-ahead log is cleaned in the background (SC-006)', async () => {
  const { dbFile } = await eraseWhileAnotherConnectionReads();
  reader!.exec('COMMIT');
  reader!.close();
  // No restart and no further request: the retry alone must clean the WAL.
  expect(await waitFor(() => !walContainsPersonalData(dbFile), 3000)).toBe(true);
}, 15_000);

it('N-1: retries stop after the attempt limit with one warning; dispose cancels a pending retry', () => {
  dir = mkdtempSync(join(tmpdir(), 'roombook-n1-unit-'));
  const file = join(dir, 'unit.db');
  const db = openDatabase(file);
  try {
    db.exec('CREATE TABLE t (x INTEGER)');
    db.exec('INSERT INTO t VALUES (1)');
    reader = new DatabaseSync(file);
    reader.exec('BEGIN');
    reader.prepare('SELECT * FROM t').all();
    db.exec('INSERT INTO t VALUES (2)');

    const queue: Array<() => void> = [];
    const warnings: string[] = [];
    let cancelled = 0;
    const flusher = new SqliteStorageFlusher(db, {
      maxAttempts: 3,
      schedule: (fn) => { queue.push(fn); return queue.length; },
      cancel: () => { cancelled += 1; },
      warn: (message) => warnings.push(message),
    });

    flusher.flush(); // attempt 1: busy → retry scheduled, nothing blocks
    expect(queue).toHaveLength(1);
    queue.shift()!(); // attempt 2: still busy
    queue.shift()!(); // attempt 3: limit reached
    expect(queue).toHaveLength(0);
    expect(warnings).toHaveLength(1);

    flusher.flush(); // a new erasure restarts the budget
    expect(queue).toHaveLength(1);
    flusher.dispose();
    expect(cancelled).toBe(1);
    queue.length = 0;

    reader.exec('COMMIT');
    reader.close();
    flusher.flush(); // reader gone: the checkpoint succeeds at once
    expect(queue).toHaveLength(0);
  } finally {
    db.close();
  }
});
