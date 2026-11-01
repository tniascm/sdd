/**
 * `npm run seed` (T051): creates the first administrator from ADMIN_EMAIL / ADMIN_PASSWORD /
 * ADMIN_DISPLAY_NAME and six demo rooms. Safe to run again: existing accounts and rooms with the
 * same name are left untouched.
 */
import { loadConfig } from '../src/config.ts';
import { buildContainer } from '../src/container.ts';
import type { Equipment } from '../src/domain/types.ts';
import { systemClock } from '../src/infrastructure/system-clock.ts';

const DEMO_ROOMS: { name: string; building: string; capacity: number; equipment: Equipment[] }[] = [
  { name: 'Aurora', building: 'Main Library', capacity: 4, equipment: ['whiteboard'] },
  { name: 'Borealis', building: 'Main Library', capacity: 6, equipment: ['whiteboard', 'display-screen'] },
  { name: 'Cedar', building: 'Science Hall', capacity: 8, equipment: ['projector', 'whiteboard'] },
  { name: 'Delta', building: 'Science Hall', capacity: 2, equipment: [] },
  { name: 'Elm', building: 'Arts Building', capacity: 12, equipment: ['projector', 'video-conferencing'] },
  { name: 'Fjord', building: 'Arts Building', capacity: 20, equipment: ['display-screen', 'video-conferencing', 'whiteboard'] },
];

const config = loadConfig(process.env);
const container = buildContainer({ dbFile: config.dbFile, clock: systemClock, config });
try {
  let adminId: string | null = null;
  if (config.admin) {
    await container.bootstrapAdmin();
    adminId = container.repos.users.findByEmail(config.admin.email)?.id ?? null;
    console.log(`Administrator: ${config.admin.email}`);
  } else {
    console.warn('ADMIN_EMAIL / ADMIN_PASSWORD are not set: no administrator was created.');
  }

  let created = 0;
  for (const room of DEMO_ROOMS) {
    if (container.repos.rooms.findByName(room.name)) continue;
    container.rooms.create(adminId, room);
    created += 1;
  }
  console.log(`Demo rooms: ${created} created, ${DEMO_ROOMS.length - created} already present (database ${config.dbFile}).`);
} finally {
  container.close();
}
