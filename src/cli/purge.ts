/** FR-021 maintenance task: `npm run purge` deletes data older than the 12-month retention. */
import { loadConfig } from '../config.ts';
import { buildContainer } from '../container.ts';
import { systemClock } from '../infrastructure/system-clock.ts';

const config = loadConfig(process.env);
const container = buildContainer({ dbFile: config.dbFile, clock: systemClock, config });
try {
  const result = container.maintenance.purge();
  const cutoff = new Date(result.cutoff).toISOString();
  console.log(`Retention cutoff: ${cutoff} (12 months ago)`);
  console.log(`Deleted bookings that ended before the cutoff: ${result.deletedBookings}`);
  console.log(`Deleted audit events recorded before the cutoff: ${result.deletedAuditEvents}`);
} finally {
  container.close();
}
