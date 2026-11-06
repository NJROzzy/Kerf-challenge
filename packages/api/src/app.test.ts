import type { Session, SyncPage } from '@kerf/shared';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from './app';
import { openDb, type Db } from './db';
import { csvText } from './routes/export';
import { tokenHash } from './security';

let db: Db;
let server: Server;
let app: ReturnType<typeof createApp>;
let base: string;
let directory: string;
let path: string;
const connection = 'test-connection-00000001';

async function listen() {
  app = createApp(db, { pollMs: 120, leaseMs: 1000, sweepMs: 10 });
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No API port');
  base = `http://127.0.0.1:${address.port}`;
}
async function stop() {
  app.locals.dispose();
  const closed = once(server, 'close');
  server.close();
  server.closeAllConnections();
  await closed;
}
function call(route: string, token?: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
  return fetch(base + route, { method, headers: {
    'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}),
  }, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function login(name = 'Alex'): Promise<Session> {
  const response = await call('/auth/login', undefined, { name, password: `kerf-${name.toLowerCase()}-demo` });
  expect(response.status).toBe(200);
  return response.json();
}
async function sync(token: string, previous?: SyncPage, id = connection): Promise<SyncPage> {
  const query = new URLSearchParams({ connectionId: id, wait: '0' });
  if (previous) { query.set('after', String(previous.cursor)); query.set('epoch', previous.epoch); }
  const response = await call(`/sync?${query}`, token);
  expect(response.status).toBe(200);
  return response.json();
}
function reading(label = 'Test reading', clientId?: string) {
  return { value: 1217, label, deviceId: 'TP-TEST', ...(clientId ? { clientId } : {}) };
}
function insert(groupId: number, label: string, value = 1217, createdBy = 1) {
  return Number(db.prepare(`INSERT INTO measurements (group_id, value, label, device_id, created_at, created_by)
    VALUES (?, ?, ?, 'TP-DIRECT', 42, ?)`).run(groupId, value, label, createdBy).lastInsertRowid);
}

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'kerf-test-'));
  path = join(directory, 'test.db');
  db = openDb(path);
  await listen();
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await stop();
  db.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('authentication', () => {
  it('logs in all seeded users with salted hashes and unpredictable per-login tokens', async () => {
    const a = await login('Alex');
    const b = await login('Alex');
    expect(a.token).toMatch(/^[a-f0-9]{64}$/);
    expect(a.token).not.toBe(b.token);
    expect((await login('Priya')).user.name).toBe('Priya');
    expect((await login('Sam')).user.name).toBe('Sam');
    expect(a.expiresAt).toBeGreaterThan(Date.now());
    const saved = db.prepare('SELECT token_hash FROM sessions WHERE user_id = 1').all();
    expect(saved).not.toContainEqual({ token_hash: a.token });
    const user = db.prepare('SELECT password_hash FROM users WHERE id = 1').get() as { password_hash: string };
    expect(user.password_hash).not.toContain('kerf-alex-demo');
    expect((await call('/me', a.token)).status).toBe(200);
  });
  it('rejects invalid credentials, malformed input and the old fixed bearer token', async () => {
    expect((await call('/auth/login', undefined, { name: 'Alex', password: 'incorrect' })).status).toBe(401);
    expect((await call('/auth/login', undefined, { name: 'Nobody', password: 'incorrect' })).status).toBe(401);
    expect((await call('/auth/login', undefined, { name: [], password: 42 })).status).toBe(400);
    expect((await call('/me', 'alex-7f3c2a91')).status).toBe(401);
    expect((await call('/projects', 'a'.repeat(64))).status).toBe(401);
  });
  it('restores the same session after a complete API/database restart', async () => {
    const session = await login();
    await stop();
    db.close();
    db = openDb(path);
    await listen();
    expect(await (await call('/me', session.token)).json()).toEqual(session.user);
  });
  it('invalidates logout server-side while keeping another login valid', async () => {
    const a = await login();
    const b = await login();
    expect((await call('/auth/logout', a.token, undefined, 'POST')).status).toBe(204);
    expect((await call('/me', a.token)).status).toBe(401);
    expect((await call('/auth/logout', a.token, undefined, 'POST')).status).toBe(401);
    expect((await call('/me', b.token)).status).toBe(200);
  });
  it('rejects expired sessions on every protected surface', async () => {
    const { token } = await login();
    db.prepare('UPDATE sessions SET expires_at = 0 WHERE token_hash = ?').run(tokenHash(token));
    for (const route of ['/me', '/projects', '/projects/1/measurements', '/feed', '/export.csv', `/sync?connectionId=${connection}`]) {
      expect((await call(route, token)).status).toBe(401);
    }
    expect((await call('/presence/' + connection, token, undefined, 'DELETE')).status).toBe(401);
  });
  it('rate limits repeated credential attempts', async () => {
    for (let i = 0; i < 20; i++) await call('/auth/login', undefined, {});
    // Validly shaped attempts are counted before expensive password verification.
    for (let i = 0; i < 20; i++) await call('/auth/login', undefined, { name: 'Nobody', password: 'x' });
    const limited = await call('/auth/login', undefined, { name: 'Alex', password: 'x' });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBeTruthy();
  });
});

describe('project authorization and request validation', () => {
  it('lists only each account’s projects and protects reads and writes', async () => {
    const alex = await login();
    const priya = await login('Priya');
    const sam = await login('Sam');
    for (const [session, ids] of [[alex, [1, 2, 3]], [priya, [1]], [sam, [4]]] as const) {
      const projects = await (await call('/projects', session.token)).json();
      expect(projects.map((p: { id: number }) => p.id)).toEqual(ids);
      expect((await call(`/projects/${ids[0]}/measurements`, session.token)).status).toBe(200);
    }
    for (const session of [priya, sam]) {
      const forbidden = session === priya ? 2 : 1;
      expect((await call(`/projects/${forbidden}/measurements`, session.token)).status).toBe(404);
      expect((await call('/groups/4/measurements', session.token, reading())).status).toBe(404);
    }
    const feed = await (await call('/feed', priya.token)).json();
    expect(feed.every((item: { projectId: number }) => item.projectId === 1)).toBe(true);
  });
  it('checks direct object IDs and malformed measurement input', async () => {
    const { token } = await login();
    for (const route of ['/projects/nope/measurements', '/projects/1e999/measurements']) {
      expect((await call(route, token)).status).toBe(404);
    }
    for (const body of [{ ...reading(), value: 0 }, { ...reading(), value: 1.2 }, { ...reading(), value: 2 ** 54 },
      { ...reading(), label: ' ' }, { ...reading(), label: 'x'.repeat(201) }, { ...reading(), deviceId: [] },
      { ...reading(), clientId: 'bad' }]) {
      expect((await call('/groups/1/measurements', token, body)).status).toBe(400);
    }
  });
  it('makes retries idempotent and rejects conflicting reuse', async () => {
    const { token } = await login();
    const body = reading('Repeated request', 'request-000000000001');
    const first = await (await call('/groups/1/measurements', token, body)).json();
    const second = await (await call('/groups/1/measurements', token, body)).json();
    expect(second).toEqual(first);
    expect((await call('/groups/1/measurements', token, { ...body, value: 999 })).status).toBe(409);
    expect(db.prepare('SELECT COUNT(*) AS count FROM measurements WHERE client_id = ?').get(body.clientId!)).toEqual({ count: 1 });
  });
  it('disables reset in production and signs every session out on development reset', async () => {
    const { token } = await login();
    vi.stubEnv('NODE_ENV', 'production');
    expect((await call('/dev/reset', token, undefined, 'POST')).status).toBe(404);
    vi.stubEnv('NODE_ENV', 'development');
    expect((await call('/dev/reset', token, undefined, 'POST')).status).toBe(200);
    expect((await call('/me', token)).status).toBe(401);
    expect((await login()).user.name).toBe('Alex');
  });
});

describe('durable live synchronization', () => {
  it('delivers a new shared measurement to another session without reloading', async () => {
    const alex = await login();
    const priya = await login('Priya');
    const initial = await sync(alex.token);
    const pending = call(`/sync?connectionId=${connection}&after=${initial.cursor}&epoch=${initial.epoch}`, alex.token);
    const measurement = await (await call('/groups/1/measurements', priya.token, reading('Live from Priya'))).json();
    const next: SyncPage = await (await pending).json();
    expect(next.items.map((item) => item.id)).toContain(measurement.id);
    expect(next.items.find((item) => item.id === measurement.id)?.capturedBy).toBe('Priya');
  });
  it('never delivers another project’s events, including after reconnect', async () => {
    const alex = await login();
    const priya = await login('Priya');
    const sam = await login('Sam');
    const initial = await sync(priya.token);
    await call('/groups/4/measurements', alex.token, reading('Alex private'));
    await call('/groups/9/measurements', sam.token, reading('Sam private'));
    const next = await sync(priya.token, initial);
    expect(next.items).toEqual([]);
    expect(next.cursor).toBeGreaterThan(initial.cursor);
    expect((await sync(sam.token)).items.every((item) => item.projectId === 4)).toBe(true);
  });
  it('recovers every missed row across pages in ID order with equal/backdated timestamps', async () => {
    const { token } = await login();
    const initial = await sync(token);
    const expected: number[] = [];
    for (let i = 0; i < 451; i++) {
      expected.push(insert(1, `Missed ${i}`));
      if (i % 10 === 0) insert(9, 'Not authorized', 500, 2);
    }
    let cursor = initial;
    const recovered: number[] = [];
    do {
      cursor = await sync(token, cursor);
      expect(cursor.reset).toBe(false);
      recovered.push(...cursor.items.map((item) => item.id));
    } while (cursor.hasMore);
    expect(recovered).toEqual(expected);
    expect(new Set(recovered).size).toBe(451);
    expect((await sync(token, cursor)).items).toEqual([]);
  });
  it('recovers writes between the first snapshot and subscription and replays a lost response', async () => {
    const { token } = await login();
    const initial = await sync(token);
    const id = insert(1, 'In the subscription gap');
    const first = await sync(token, initial);
    const replay = await sync(token, initial);
    expect(first.items.map((item) => item.id)).toEqual([id]);
    expect(replay.items).toEqual(first.items);
  });
  it('continues from the durable cursor after API restart', async () => {
    const { token } = await login();
    const initial = await sync(token);
    await stop();
    db.close();
    db = openDb(path);
    const id = insert(1, 'During reconnect');
    await listen();
    const next = await sync(token, initial);
    expect(next.epoch).toBe(initial.epoch);
    expect(next.reset).toBe(false);
    expect(next.items.map((item) => item.id)).toEqual([id]);
  });
  it('replaces a stale snapshot when the database epoch changes', async () => {
    const { token } = await login();
    const initial = await sync(token);
    db.prepare("UPDATE metadata SET value = 'replacement-database' WHERE key = 'epoch'").run();
    expect((await sync(token, initial)).reset).toBe(true);
  });
  it('rejects malformed cursors and detects revocation during a waiting request', async () => {
    const { token } = await login();
    for (const query of ['after=-1', 'after=NaN', 'after=1.5', 'after=9007199254740993']) {
      expect((await call(`/sync?connectionId=${connection}&${query}`, token)).status).toBe(400);
    }
    expect((await call('/sync?connectionId=bad', token)).status).toBe(400);
    const initial = await sync(token);
    const pending = call(`/sync?connectionId=${connection}&after=${initial.cursor}&epoch=${initial.epoch}`, token);
    await call('/auth/logout', token, undefined, 'POST');
    expect((await pending).status).toBe(401);
  });
});

describe('presence leases', () => {
  it('deduplicates a user across connections/sessions and keeps their other login online', async () => {
    const first = await login();
    const second = await login();
    const priya = await login('Priya');
    const a = 'alex-connection-000001';
    const b = 'alex-connection-000002';
    await sync(first.token, undefined, a);
    await sync(first.token, undefined, b);
    await sync(second.token, undefined, a);
    expect((await sync(priya.token)).online.map((user) => user.name)).toEqual(['Alex', 'Priya']);
    await call('/presence/' + a, first.token, undefined, 'DELETE');
    expect((await sync(priya.token)).online.filter((user) => user.name === 'Alex')).toHaveLength(1);
    await call('/auth/logout', first.token, undefined, 'POST');
    expect((await sync(priya.token)).online.map((user) => user.name)).toContain('Alex');
    await call('/auth/logout', second.token, undefined, 'POST');
    expect((await sync(priya.token)).online.map((user) => user.name)).not.toContain('Alex');
  });
  it('only shows people who share a project and scopes connection deletion to the session', async () => {
    const alex = await login();
    const sam = await login('Sam');
    const priya = await login('Priya');
    await sync(alex.token);
    await sync(sam.token);
    expect((await sync(priya.token)).online.map((user) => user.name)).toEqual(['Alex', 'Priya']);
    expect((await sync(sam.token)).online.map((user) => user.name)).toEqual(['Sam']);
    await call('/presence/' + connection, sam.token, undefined, 'DELETE');
    expect((await sync(priya.token)).online.map((user) => user.name)).toContain('Alex');
  });
  it('expires an abandoned connection and permits a fresh heartbeat', async () => {
    const alex = await login();
    const priya = await login('Priya');
    await sync(alex.token);
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 1001);
    const stale = await sync(priya.token);
    expect(stale.online.map((user) => user.name)).not.toContain('Alex');
    await sync(alex.token);
    expect((await sync(priya.token)).online.map((user) => user.name)).toContain('Alex');
  });
  it('expires presence after a transport disappears without a clean leave request', async () => {
    const alex = await login();
    const priya = await login('Priya');
    const initial = await sync(alex.token);
    const controller = new AbortController();
    const pending = fetch(`${base}/sync?connectionId=${connection}&after=${initial.cursor}&epoch=${initial.epoch}`, {
      headers: { authorization: `Bearer ${alex.token}` }, signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toThrow();
    // No explicit DELETE: only the server lease can remove this abandoned user.
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 1001);
    expect((await sync(priya.token)).online.map((user) => user.name)).not.toContain('Alex');
  });
  it('renews a lease and removes closed connections immediately', async () => {
    const alex = await login();
    const priya = await login('Priya');
    await sync(alex.token);
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 800);
    await sync(alex.token);
    vi.spyOn(Date, 'now').mockReturnValue(now + 1500);
    expect((await sync(priya.token)).online.map((user) => user.name)).toContain('Alex');
    await call('/presence/' + connection, alex.token, undefined, 'DELETE');
    expect((await sync(priya.token)).online.map((user) => user.name)).not.toContain('Alex');
  });
});

function parseCsv(csv: string) {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (c === '"') {
      if (quoted && csv[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted;
    } else if (!quoted && c === ',') { row.push(field); field = ''; }
    else if (!quoted && c === '\r' && csv[i + 1] === '\n') {
      row.push(field); rows.push(row); row = []; field = ''; i++;
    } else field += c;
  }
  return rows;
}

describe('CSV exports', () => {
  it('exports meaningful headers, exact numeric values, display units, author, device and UTC dates', async () => {
    const { token } = await login('Priya');
    const response = await call('/export.csv?unit=fractional', token);
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(response.headers.get('content-disposition')).toContain('attachment');
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([239, 187, 191]);
    const rows = parseCsv(new TextDecoder().decode(bytes));
    expect(rows[0]).toEqual(['Project', 'Group', 'Label', 'Measurement (mm)', 'Measurement (inches)',
      'Display measurement', 'Captured by', 'Device', 'Captured at (UTC)', 'Measurement ID']);
    expect(rows).toHaveLength(13);
    const sink = rows.find((row) => row[2] === 'Sink wall run')!;
    expect(sink[3]).toBe('3048');
    expect(Number(sink[4])).toBe(120);
    expect(sink[5]).toBe('120"');
    expect(sink[6]).toBe('Alex');
    expect(sink[7]).toBe('TP-3F2A');
    expect(sink[8]).toMatch(/Z$/);
  });
  it('escapes Unicode, commas, quotes, and embedded newlines and preserves integer precision', async () => {
    const { token } = await login();
    const label = 'Café, "north"\r\nSecond line';
    const id = insert(1, label, 9007199254740991);
    const rows = parseCsv(await (await call('/projects/1/export.csv', token)).text());
    const row = rows.find((entry) => entry[9] === String(id))!;
    expect(row[2]).toBe(label);
    expect(row[3]).toBe('9007199254740991');
  });
  it('neutralizes formula injection in every textual field', async () => {
    const { token } = await login();
    const id = insert(1, '=HYPERLINK("https://example.com")');
    db.prepare("UPDATE projects SET name = '+Project' WHERE id = 1").run();
    db.prepare("UPDATE measurement_groups SET name = '@Group' WHERE id = 1").run();
    db.prepare("UPDATE users SET name = '-User' WHERE id = 1").run();
    db.prepare("UPDATE measurements SET device_id = '  =DEVICE()' WHERE id = ?").run(id);
    const row = parseCsv(await (await call('/export.csv', token)).text()).find((entry) => entry[9] === String(id))!;
    for (const index of [0, 1, 2, 6, 7]) expect(row[index].startsWith("'")).toBe(true);
    for (const text of ['=1', '+1', '-1', '@SUM(1)', '  =1', '\ttext', '\rtext', '\ntext']) {
      expect(csvText(text).startsWith('"\'')).toBe(true);
    }
  });
  it('isolates exports, handles empty projects, and rejects invalid units', async () => {
    const priya = await login('Priya');
    expect((await call('/export.csv')).status).toBe(401);
    expect((await call('/projects/2/export.csv', priya.token)).status).toBe(404);
    expect((await call('/projects/nope/export.csv', priya.token)).status).toBe(404);
    expect((await call('/export.csv?unit=feet', priya.token)).status).toBe(400);
    const rows = parseCsv(await (await call('/export.csv', priya.token)).text());
    expect(rows.slice(1).every((row) => row[0] === 'Hendricks Kitchen Remodel')).toBe(true);
    const ids = rows.slice(1).map((row) => Number(row[9]));
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    db.prepare('DELETE FROM measurements WHERE group_id IN (SELECT id FROM measurement_groups WHERE project_id = 1)').run();
    expect(parseCsv(await (await call('/projects/1/export.csv', priya.token)).text())).toHaveLength(1);
  });
});

it('migrates the original fixed-token database without losing projects, memberships or measurements', async () => {
  const legacyPath = join(directory, 'legacy.db');
  const legacy = new DatabaseSync(legacyPath);
  legacy.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, token TEXT NOT NULL UNIQUE);
    INSERT INTO users VALUES (1, 'Alex', 'alex-7f3c2a91');
    CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, owner_id INTEGER);
    INSERT INTO projects VALUES (90, 'Keep this project', 1);
    CREATE TABLE project_members (project_id INTEGER, user_id INTEGER, PRIMARY KEY(project_id, user_id));
    INSERT INTO project_members VALUES (90, 1);
    CREATE TABLE measurement_groups (id INTEGER PRIMARY KEY, project_id INTEGER, name TEXT);
    INSERT INTO measurement_groups VALUES (91, 90, 'Keep this group');
    CREATE TABLE measurements (id INTEGER PRIMARY KEY, group_id INTEGER, value INTEGER, label TEXT,
      device_id TEXT, created_at INTEGER, created_by INTEGER);
    INSERT INTO measurements VALUES (92, 91, 1217, 'Keep this reading', 'TP-OLD', 42, 1);`);
  legacy.close();
  const migrated = openDb(legacyPath);
  try {
    expect(migrated.prepare('SELECT name FROM projects WHERE id = 90').get()).toEqual({ name: 'Keep this project' });
    expect(migrated.prepare('SELECT * FROM project_members').all()).toEqual([{ project_id: 90, user_id: 1 }]);
    expect(migrated.prepare('SELECT value FROM measurements WHERE id = 92').get()).toEqual({ value: 1217 });
    expect(migrated.prepare('SELECT password_hash FROM users').get()?.password_hash).toBeTruthy();
    expect(migrated.prepare('SELECT token FROM users').get()?.token).not.toBe('alex-7f3c2a91');
  } finally { migrated.close(); }
});
