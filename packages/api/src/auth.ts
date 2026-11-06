import { Router, type NextFunction, type Request, type Response } from 'express';

import type { Db } from './db';
import { hashPassword, newToken, tokenHash, verifyPassword } from './security';

declare global {
  namespace Express {
    interface Request {
      userId: number;
      sessionHash: string;
    }
  }
}

export const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

export function sessionValid(db: Db, hash: string) {
  return !!db.prepare('SELECT 1 FROM sessions WHERE token_hash = ? AND expires_at > ?').get(hash, Date.now());
}

export function requireUser(db: Db) {
  const find = db.prepare('SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?');
  return (req: Request, res: Response, next: NextFunction) => {
    const token = /^Bearer ([a-f0-9]{64})$/i.exec(req.get('authorization') ?? '')?.[1];
    const hash = token ? tokenHash(token) : '';
    const session = find.get(hash, Date.now()) as { user_id: number } | undefined;
    if (!session) {
      res.status(401).json({ error: 'Your session has ended. Please sign in again.' });
      return;
    }
    req.userId = session.user_id;
    req.sessionHash = hash;
    next();
  };
}

export function authRouter(db: Db) {
  const router = Router();
  const dummyHash = hashPassword(newToken());
  const attempts = new Map<string, { count: number; until: number }>();

  router.post('/auth/login', async (req, res) => {
    const { name, password } = req.body ?? {};
    if (typeof name !== 'string' || !name.trim() || name.length > 100 ||
        typeof password !== 'string' || !password || password.length > 256) {
      res.status(400).json({ error: 'Enter your name and password.' });
      return;
    }
    const now = Date.now();
    for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
    const key = req.ip ?? 'unknown';
    const attempt = attempts.get(key) ?? { count: 0, until: now + 60_000 };
    attempts.set(key, attempt);
    if (++attempt.count > 20) {
      res.set('Retry-After', String(Math.ceil((attempt.until - now) / 1000)));
      res.status(429).json({ error: 'Too many sign-in attempts. Try again in a minute.' });
      return;
    }
    const user = db.prepare('SELECT id, name, password_hash FROM users WHERE name = ? COLLATE NOCASE')
      .get(name.trim()) as { id: number; name: string; password_hash: string } | undefined;
    const valid = await verifyPassword(password, user?.password_hash ?? dummyHash);
    if (!user || !valid) {
      res.status(401).json({ error: 'Name or password is incorrect.' });
      return;
    }
    const token = newToken();
    const expiresAt = Date.now() + SESSION_MS;
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
    db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .run(tokenHash(token), user.id, expiresAt);
    res.json({ token, expiresAt, user: { id: user.id, name: user.name } });
  });
  return router;
}
