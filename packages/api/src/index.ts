import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from './app';
import { openDb } from './db';

const PORT = Number(process.env.PORT ?? 4000);
process.env.NODE_ENV ??= process.argv.includes('--dev') ? 'development' : 'production';
const DB_PATH =
  process.env.DB_PATH ?? join(dirname(fileURLToPath(import.meta.url)), '../data/kerf.db');

mkdirSync(dirname(DB_PATH), { recursive: true });
const db = openDb(DB_PATH);

const app = createApp(db);
const server = app.listen(PORT, () => {
  console.log(`Kerf API listening on http://localhost:${PORT}`);
});

function shutdown() {
  app.locals.dispose();
  server.close();
  server.closeAllConnections();
  db.close();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Stop the other process or set PORT.`);
    process.exit(1);
  }
  throw err;
});
