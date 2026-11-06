import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api, setAuth } from './api';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('expo-constants', () => ({ default: {} }));

const token = 'a'.repeat(64);
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('location', { hostname: 'localhost' });
  setAuth(token, () => {});
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('authenticated HTTP requests', () => {
  it('uses bearer headers for protected calls and leaves credentials out of URLs', async () => {
    const fetchMock = vi.fn(async () => new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await api.projects()).toEqual([]);
    expect(fetchMock.mock.calls[0]).toMatchObject([
      'http://localhost:4000/projects', { headers: { authorization: `Bearer ${token}` } },
    ]);
  });
  it('keeps a failed public login from invalidating an existing session', async () => {
    const invalid = vi.fn();
    setAuth(token, invalid);
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('{"error":"Incorrect credentials"}', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(api.login('Alex', 'wrong')).rejects.toMatchObject({ status: 401 });
    expect(invalid).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0]?.[1]?.headers).not.toHaveProperty('authorization');
  });
  it('invalidates expired authentication on CSV exports too', async () => {
    const invalid = vi.fn();
    setAuth(token, invalid);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"Expired"}', { status: 401 })));
    await expect(api.exportCsv('metric')).rejects.toMatchObject({ status: 401 });
    expect(invalid).toHaveBeenCalledWith(token);
  });
  it('times out a stalled body after headers have arrived', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options: RequestInit) => ({
      ok: true, status: 200,
      json: () => new Promise((_resolve, reject) => options.signal?.addEventListener('abort', () => reject(new Error('aborted')))),
    })));
    const result = expect(api.projects()).rejects.toThrow('Request timed out');
    await vi.advanceTimersByTimeAsync(12_000);
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });
  it('honors cancellation and clears the long-poll timeout', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    })));
    const controller = new AbortController();
    const result = expect(api.sync('connection-0000000001', undefined, controller.signal)).rejects.toThrow('aborted');
    controller.abort();
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });
});
