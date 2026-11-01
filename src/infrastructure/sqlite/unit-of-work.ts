import type { DatabaseSync } from 'node:sqlite';
import type { UnitOfWork } from '../../application/ports.ts';

/**
 * Synchronous transactions over `node:sqlite` (research R3, NFR-006).
 * The outermost call uses BEGIN IMMEDIATE so the write lock is taken before any read;
 * nested calls use savepoints so an inner failure rolls back only the inner work.
 */
export class SqliteUnitOfWork implements UnitOfWork {
  private readonly db: DatabaseSync;
  private depth = 0;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  transaction<T>(fn: () => T): T {
    const savepoint = this.depth > 0 ? `uow_${this.depth}` : null;
    this.db.exec(savepoint ? `SAVEPOINT ${savepoint}` : 'BEGIN IMMEDIATE');
    this.depth += 1;
    try {
      const result = fn();
      if (isThenable(result)) {
        result.then(undefined, () => undefined); // the caller already gets the error below
        throw new TypeError('UnitOfWork.transaction callback must be synchronous (no await inside a transaction)');
      }
      this.db.exec(savepoint ? `RELEASE ${savepoint}` : 'COMMIT');
      return result;
    } catch (err) {
      this.db.exec(savepoint ? `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}` : 'ROLLBACK');
      throw err;
    } finally {
      this.depth -= 1;
    }
  }
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return typeof value === 'object' && value !== null && typeof (value as { then?: unknown }).then === 'function';
}
