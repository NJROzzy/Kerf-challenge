import type { SyncPage, User } from '@kerf/shared';
import { Router } from 'express';

import { sessionValid } from './auth';
import type { Db } from './db';
import { readFeed } from './routes/feed';

export const LEASE_MS = 45_000;
export const POLL_MS = 20_000;
const PAGE_SIZE = 200;

// SQLite is the source of truth. Notifications only shorten the wait; lost notifications
// (including an API restart) cannot lose measurements. All queries recheck membership.
export function createLive(db: Db, options: { pollMs?: number; leaseMs?: number; sweepMs?: number } = {}) {
  const router = Router();
  const waiting = new Set<() => void>();
  const cleanups = new Set<() => void>();
  const notify = () => { for (const wake of [...waiting]) wake(); };
  const leaseMs = options.leaseMs ?? LEASE_MS;
  const online = (userId: number) => db.prepare(`
    SELECT DISTINCT u.id, u.name FROM presence pr
    JOIN sessions s ON s.token_hash = pr.session_hash
    JOIN users u ON u.id = s.user_id
    WHERE pr.expires_at > ? AND s.expires_at > ? AND EXISTS (
      SELECT 1 FROM project_members mine
      JOIN project_members theirs ON theirs.project_id = mine.project_id
      WHERE mine.user_id = ? AND theirs.user_id = u.id
    ) ORDER BY u.name, u.id
  `).all(Date.now(), Date.now(), userId) as unknown as User[];

  function page(userId: number, after?: number, clientEpoch?: string): SyncPage {
    const { value: epoch } = db.prepare("SELECT value FROM metadata WHERE key = 'epoch'").get() as { value: string };
    const { cursor: highWater } = db.prepare('SELECT COALESCE(MAX(id), 0) AS cursor FROM measurements').get() as { cursor: number };
    const reset = after === undefined || clientEpoch !== epoch || after > highWater;
    const items = readFeed(db, userId, reset ? undefined : after, reset ? 20 : PAGE_SIZE + 1);
    const hasMore = !reset && items.length > PAGE_SIZE;
    if (hasMore) items.pop();
    return {
      items, epoch, reset, hasMore,
      cursor: hasMore ? items[items.length - 1].id : highWater,
      online: online(userId),
    };
  }

  const sweeper = setInterval(() => {
    const result = db.prepare('DELETE FROM presence WHERE expires_at <= ?').run(Date.now());
    if (result.changes) notify();
  }, options.sweepMs ?? 5_000);
  sweeper.unref();

  router.get('/sync', (req, res) => {
    const connectionId = req.query.connectionId;
    const rawAfter = req.query.after;
    const after = rawAfter === undefined ? undefined : Number(rawAfter);
    const epoch = req.query.epoch;
    if (typeof connectionId !== 'string' || !/^[a-zA-Z0-9-]{16,100}$/.test(connectionId) ||
        (rawAfter !== undefined && (typeof rawAfter !== 'string' || !/^\d+$/.test(rawAfter) || !Number.isSafeInteger(after))) ||
        (epoch !== undefined && (typeof epoch !== 'string' || epoch.length > 100))) {
      res.status(400).json({ error: 'Invalid synchronization cursor or connection.' });
      return;
    }
    const previous = db.prepare('SELECT expires_at FROM presence WHERE session_hash = ? AND connection_id = ?')
      .get(req.sessionHash, connectionId) as { expires_at: number } | undefined;
    db.prepare(`INSERT INTO presence (session_hash, connection_id, expires_at) VALUES (?, ?, ?)
      ON CONFLICT(session_hash, connection_id) DO UPDATE SET expires_at = excluded.expires_at`)
      .run(req.sessionHash, connectionId, Date.now() + leaseMs);
    if (!previous || previous.expires_at <= Date.now()) notify();

    const initial = page(req.userId, after, epoch as string | undefined);
    if (initial.reset || initial.items.length || req.query.wait === '0') {
      res.json(initial);
      return;
    }
    const initialOnline = JSON.stringify(initial.online);
    let timer: ReturnType<typeof setTimeout>;
    const cleanup = () => { clearTimeout(timer); waiting.delete(wake); cleanups.delete(cleanup); };
    const finish = (force: boolean) => {
      if (!sessionValid(db, req.sessionHash)) {
        cleanup();
        res.status(401).json({ error: 'Your session has ended. Please sign in again.' });
        return;
      }
      const next = page(req.userId, after, epoch as string | undefined);
      if (force || next.reset || next.items.length || JSON.stringify(next.online) !== initialOnline) {
        cleanup();
        res.json(next);
      }
    };
    const wake = () => finish(false);
    // No await between the snapshot and registration: a write cannot enter this gap.
    waiting.add(wake);
    cleanups.add(cleanup);
    timer = setTimeout(() => finish(true), options.pollMs ?? POLL_MS);
    res.on('close', cleanup);
  });

  router.delete('/presence/:connectionId', (req, res) => {
    db.prepare('DELETE FROM presence WHERE session_hash = ? AND connection_id = ?')
      .run(req.sessionHash, req.params.connectionId as string);
    notify();
    res.status(204).end();
  });

  return {
    router, notify,
    dispose: () => {
      clearInterval(sweeper);
      for (const cleanup of [...cleanups]) cleanup();
    },
  };
}
