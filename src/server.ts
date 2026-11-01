/** Entry point: `npm start` (Node runs this TypeScript file natively — research R1). */
import { loadConfig } from './config.ts';
import { buildContainer } from './container.ts';
import { createApp } from './http/app.ts';
import { systemClock } from './infrastructure/system-clock.ts';

const config = loadConfig(process.env);
const container = buildContainer({ dbFile: config.dbFile, clock: systemClock, config });
await container.bootstrapAdmin();

const server = createApp(container).listen(config.port, (error?: Error) => {
  if (error) {
    console.error(`RoomBook could not listen on port ${config.port}: ${error.message}`);
    container.close();
    process.exit(1);
  }
  console.log(`RoomBook listening on http://localhost:${config.port} (API: /api/v1)`);
});

function shutdown(): void {
  server.close(() => {
    container.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
