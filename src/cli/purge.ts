/** FR-021 maintenance task: `npm run purge` deletes data older than the 12-month retention. */
import { loadConfig } from '../config.ts';
import { buildContainer } from '../container.ts';
import { systemClock } from '../infrastructure/system-clock.ts';

const config = loadConfig(process.env);
const container = buildContainer({ dbFile: config.dbFile, clock: systemClock, config });
try {
  const result = container.maintenance.purge();
  const cutoff = new Date(result.cutoff).toISOString();
  const shortCutoff = new Date(result.shortCutoff).toISOString();
  console.log(`Retention cutoff for bookings and audit events: ${cutoff} (12 months ago)`);
  console.log(`Deleted bookings that ended before it: ${result.deletedBookings}`);
  console.log(`Deleted audit events recorded before it: ${result.deletedAuditEvents}`);
  console.log(`Retention cutoff for sign-in failures and sessions: ${shortCutoff} (24 hours ago)`);
  console.log(`Deleted sign-in failure records: ${result.deletedLoginFailures}`);
  console.log(`Deleted expired or revoked sessions: ${result.deletedSessions}`);
} finally {
  container.close();
}
