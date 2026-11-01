import type { DatabaseSync } from 'node:sqlite';
import type { StorageFlusher } from '../../application/ports.ts';

/**
 * FR-019 / R-2: after an erasure, copy the latest pages into the database file and truncate the
 * write-ahead log, so no earlier page version (still holding the erased data) remains on disk.
 * Together with `PRAGMA secure_delete = ON` the deleted content is overwritten with zeros.
 */
export class SqliteStorageFlusher implements StorageFlusher {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  flush(): void {
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  }
}
