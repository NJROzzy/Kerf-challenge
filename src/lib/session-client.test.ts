import type { Session } from '@kerf/shared';
import { describe, expect, it, vi } from 'vitest';

import { SessionClient, type SessionStorage } from './session-client';

const session: Session = { token: 'a'.repeat(64), user: { id: 1, name: 'Alex' }, expiresAt: Date.now() + 86_400_000 };
function setup(raw: string | null = null) {
  let saved = raw;
  const storage: SessionStorage = {
    read: vi.fn(async () => saved),
    write: vi.fn(async (value) => { saved = value; }),
    remove: vi.fn(async () => { saved = null; }),
  };
  const transport = {
    login: vi.fn(async () => session),
    me: vi.fn(async () => session.user),
    logout: vi.fn(async () => {}),
  };
  return { client: new SessionClient(storage, transport), storage, transport, saved: () => saved };
}
describe('session lifecycle on the client', () => {
  it('starts signed out when no session is saved', async () => {
    const { client } = setup();
    await client.restore();
    expect(client.getSnapshot()).toEqual({ ready: true, session: undefined });
  });
  it('persists login, restores the same token and verifies identity with the API', async () => {
    const { client, storage, transport, saved } = setup();
    await client.restore();
    await client.login('Alex', 'password');
    expect(storage.write).toHaveBeenCalledWith(JSON.stringify(session));
    const restarted = new SessionClient(storage, transport);
    await restarted.restore();
    expect(transport.me).toHaveBeenCalledWith(session.token);
    expect(restarted.getSnapshot().session).toEqual(session);
    expect(saved()).toBeTruthy();
  });
  it('drops invalid or revoked saved sessions', async () => {
    const { client, transport, saved } = setup(JSON.stringify(session));
    transport.me.mockRejectedValueOnce({ status: 401 });
    await client.restore();
    expect(client.getSnapshot().session).toBeUndefined();
    expect(client.getSnapshot().message).toContain('session has ended');
    expect(saved()).toBeNull();
  });
  it.each(['not json', JSON.stringify({ ...session, expiresAt: 0 }), JSON.stringify({ ...session, token: 'bad' })])(
    'handles malformed or expired stored data: %s', async (raw) => {
      const { client, transport, saved } = setup(raw);
      await client.restore();
      expect(client.getSnapshot().session).toBeUndefined();
      expect(transport.me).not.toHaveBeenCalled();
      expect(saved()).toBeNull();
    },
  );
  it('retains an unexpired cached identity during an offline restart', async () => {
    const { client, transport } = setup(JSON.stringify(session));
    transport.me.mockRejectedValueOnce(new Error('offline'));
    await client.restore();
    expect(client.getSnapshot().session).toEqual(session);
    expect(client.getSnapshot().message).toContain('Connection unavailable');
  });
  it('revokes on the server before clearing local credentials', async () => {
    const { client, transport, storage, saved } = setup(JSON.stringify(session));
    await client.restore();
    await client.logout();
    expect(transport.logout).toHaveBeenCalledWith(session.token);
    expect(storage.remove).toHaveBeenCalled();
    expect(saved()).toBeNull();
    expect(client.getSnapshot().session).toBeUndefined();
  });
  it('does not claim a successful logout while offline', async () => {
    const { client, transport, saved } = setup(JSON.stringify(session));
    await client.restore();
    transport.logout.mockRejectedValueOnce(new Error('offline'));
    await expect(client.logout()).rejects.toThrow('Reconnect');
    expect(client.getSnapshot().session).toEqual(session);
    expect(saved()).toBeTruthy();
  });
  it('invalidates matching sessions but ignores late 401s from an older login', async () => {
    const { client, saved } = setup(JSON.stringify(session));
    await client.restore();
    client.invalidate('b'.repeat(64));
    expect(client.getSnapshot().session).toEqual(session);
    client.invalidate(session.token);
    expect(client.getSnapshot().session).toBeUndefined();
    await Promise.resolve();
    expect(saved()).toBeNull();
  });
  it('revokes a newly issued session if secure storage fails', async () => {
    const { client, storage, transport } = setup();
    storage.write = vi.fn(async () => { throw new Error('storage unavailable'); });
    await expect(client.login('Alex', 'password')).rejects.toThrow('Could not save');
    expect(transport.logout).toHaveBeenCalledWith(session.token);
    expect(client.getSnapshot().session).toBeUndefined();
  });
  it('clears a session already revoked by another request', async () => {
    const { client, transport } = setup(JSON.stringify(session));
    await client.restore();
    transport.logout.mockRejectedValueOnce({ status: 401 });
    await client.logout();
    expect(client.getSnapshot().session).toBeUndefined();
  });
});
