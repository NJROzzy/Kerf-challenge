import express from 'express';

import { authRouter, requireUser } from './auth';
import { type Db, resetDb } from './db';
import { createLive } from './live';
import { exportRouter } from './routes/export';
import { feedRouter } from './routes/feed';
import { measurementsRouter } from './routes/measurements';
import { projectsRouter } from './routes/projects';

export function createApp(db: Db, liveOptions: Parameters<typeof createLive>[1] = {}) {
  const app = express();
  app.disable('x-powered-by');
  const live = createLive(db, liveOptions);
  app.locals.dispose = live.dispose;

  // The app calls the API from another origin (the Expo dev server on :8081).
  app.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE');
    res.set(
      'Access-Control-Allow-Headers',
      'authorization, content-type',
    );
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });
  app.use(express.json({ limit: '16kb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use(authRouter(db));
  app.use(requireUser(db));

  app.post('/auth/logout', (req, res) => {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(req.sessionHash);
    live.notify();
    res.status(204).end();
  });

  app.get('/me', (req, res) => {
    res.json(db.prepare('SELECT id, name FROM users WHERE id = ?').get(req.userId));
  });

  app.post('/dev/reset', (_req, res) => {
    if (!['development', 'test'].includes(process.env.NODE_ENV ?? '')) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    resetDb(db);
    live.notify();
    res.json({ ok: true });
  });

  app.use(projectsRouter(db));
  app.use(measurementsRouter(db, live.notify));
  app.use(feedRouter(db));
  app.use(live.router);
  app.use(exportRouter(db));

  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use((error: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = error.status && error.status >= 400 && error.status < 500 ? error.status : 500;
    if (status === 500) console.error(error);
    res.status(status).json({ error: status === 500 ? 'Something went wrong. Please try again.' : 'Invalid request body.' });
  });

  return app;
}
