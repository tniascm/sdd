import { createApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const { app, db } = createApp(config);

const server = app.listen(config.port, () => {
  console.log(`RoomBook running at http://localhost:${config.port}`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
