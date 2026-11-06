import { DatabaseSync } from 'node:sqlite';

import { seed } from './seed';
import { demoPassword, hashPassword, newToken } from './security';

export type Db = DatabaseSync;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    password_hash TEXT
  );
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    owner_id INTEGER NOT NULL REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS project_members (
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    PRIMARY KEY (project_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS measurement_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS measurements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL REFERENCES measurement_groups(id) ON DELETE CASCADE,
    value INTEGER NOT NULL,
    label TEXT NOT NULL,
    device_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    created_by INTEGER NOT NULL REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS measurements_created_at ON measurements(created_at);
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS presence (
    session_hash TEXT NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
    connection_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    PRIMARY KEY (session_hash, connection_id)
  );
  CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

const TABLES = ['presence', 'sessions', 'measurements', 'measurement_groups', 'project_members', 'projects', 'users'];

export function openDb(path: string): Db {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  // Migrate in place: retain existing IDs, projects, memberships and readings.
  const userColumns = db.prepare('PRAGMA table_info(users)').all() as { name: string }[];
  if (!userColumns.some((c) => c.name === 'password_hash')) {
    db.exec('ALTER TABLE users ADD COLUMN password_hash TEXT');
  }
  const measurementColumns = db.prepare('PRAGMA table_info(measurements)').all() as { name: string }[];
  if (!measurementColumns.some((c) => c.name === 'client_id')) {
    db.exec('ALTER TABLE measurements ADD COLUMN client_id TEXT');
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS measurement_client_id ON measurements(created_by, client_id)');
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number };
  if (count === 0) {
    seed(db);
  }
  for (const user of db.prepare('SELECT id, name FROM users WHERE password_hash IS NULL').all() as { id: number; name: string }[]) {
    const password = ['Alex', 'Priya', 'Sam'].includes(user.name) ? demoPassword(user.name) : newToken();
    db.prepare('UPDATE users SET password_hash = ?, token = ? WHERE id = ?')
      .run(hashPassword(password), newToken(), user.id);
  }
  db.prepare("INSERT OR IGNORE INTO metadata (key, value) VALUES ('epoch', ?)").run(newToken());
  return db;
}

export function resetDb(db: Db) {
  db.exec('BEGIN');
  try {
    for (const table of TABLES) {
      db.exec(`DELETE FROM ${table}`);
    }
    db.exec('DELETE FROM sqlite_sequence');
    seed(db);
    db.prepare("UPDATE metadata SET value = ? WHERE key = 'epoch'").run(newToken());
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
