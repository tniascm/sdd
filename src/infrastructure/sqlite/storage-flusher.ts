import type { DatabaseSync } from 'node:sqlite';
import type { StorageFlusher } from '../../application/ports.ts';

export interface StorageFlusherOptions {
  /** Delay between background retries (ms). */
  retryMs?: number;
  /** Attempts in total, including the first, before giving up with a warning. */
  maxAttempts?: number;
  /** Timer functions; injectable so tests can drive the retries. */
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
  warn?: (message: string) => void;
}

/**
 * FR-019 / R-2: after an erasure, copy the latest pages into the database file and truncate the
 * write-ahead log, so no earlier page version (still holding the erased data) remains on disk.
 * Together with `PRAGMA secure_delete = ON` the deleted content is overwritten with zeros.
 *
 * N-1 (research R15): the checkpoint never blocks. It runs with `busy_timeout = 0`; if another
 * connection still holds a read snapshot (busy = 1), it is retried in the background until the
 * write-ahead log is clean, up to `maxAttempts`, and the pending retry is cancelled on `dispose()`.
 */
export class SqliteStorageFlusher implements StorageFlusher {
  private readonly db: DatabaseSync;
  private readonly retryMs: number;
  private readonly maxAttempts: number;
  private readonly schedule: (fn: () => void, ms: number) => unknown;
  private readonly cancel: (handle: unknown) => void;
  private readonly warn: (message: string) => void;
  private pending: unknown = null;
  private attempts = 0;

  constructor(db: DatabaseSync, options: StorageFlusherOptions = {}) {
    this.db = db;
    this.retryMs = options.retryMs ?? 250;
    this.maxAttempts = options.maxAttempts ?? 40;
    this.schedule = options.schedule ?? ((fn, ms) => {
      const timer = setTimeout(fn, ms);
      timer.unref(); // a pending retry must not keep the process alive
      return timer;
    });
    this.cancel = options.cancel ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    this.warn = options.warn ?? ((message) => console.warn(message));
  }

  flush(): void {
    this.attempts = 0; // a new erasure restarts the retry budget
    if (this.pending !== null) return; // the scheduled retry will checkpoint this erasure too
    this.attempt();
  }

  /** Cancels a pending background retry (called when the application closes). */
  dispose(): void {
    if (this.pending !== null) this.cancel(this.pending);
    this.pending = null;
  }

  private attempt(): void {
    this.pending = null;
    if (!this.db.isOpen) return;
    this.attempts += 1;
    if (this.checkpoint()) return;
    if (this.attempts >= this.maxAttempts) {
      this.warn(`storage flush: write-ahead log still in use after ${this.attempts} attempts; it will be cleaned at the next checkpoint`);
      return;
    }
    this.pending = this.schedule(() => this.attempt(), this.retryMs);
  }

  /** One non-blocking TRUNCATE checkpoint; true when the write-ahead log was fully checkpointed. */
  private checkpoint(): boolean {
    const previous = (this.db.prepare('PRAGMA busy_timeout').get() as { timeout: number }).timeout;
    this.db.exec('PRAGMA busy_timeout = 0');
    try {
      const row = this.db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() as { busy: number } | undefined;
      return row === undefined || row.busy === 0;
    } catch (error) {
      if (/busy|locked/i.test(String((error as Error).message))) return false;
      throw error;
    } finally {
      this.db.exec(`PRAGMA busy_timeout = ${Number(previous)}`);
    }
  }
}
