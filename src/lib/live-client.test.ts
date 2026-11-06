import type { FeedItem, SyncPage } from '@kerf/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LiveClient, mergeFeed } from './live-client';

const item = (id: number): FeedItem => ({ id, groupId: 1, projectId: 1, projectName: 'Kitchen', groupName: 'Cabinets',
  value: 1217, label: `Reading ${id}`, deviceId: 'TP-TEST', createdAt: 42, createdBy: 1, capturedBy: 'Alex' });
const page = (ids: number[], cursor = Math.max(0, ...ids), reset = false): SyncPage => ({
  items: ids.map(item), cursor, epoch: 'test-epoch', reset, hasMore: false, online: [{ id: 1, name: 'Alex' }],
});
function setup() {
  const pending: { resolve: (page: SyncPage) => void; reject: (error: unknown) => void; signal: AbortSignal }[] = [];
  const poll = vi.fn((_cursor: { after: number; epoch: string } | undefined, signal: AbortSignal) => new Promise<SyncPage>((resolve, reject) => {
    pending.push({ resolve, reject, signal });
  }));
  const client = new LiveClient(poll);
  return { client, poll, pending };
}
beforeEach(() => { vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(0); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('live feed recovery and lifecycle', () => {
  it('deduplicates replayed rows and uses ID ordering even when timestamps tie', () => {
    expect(mergeFeed([item(2), item(1)], page([2, 3])).map((entry) => entry.id)).toEqual([3, 2, 1]);
    expect(mergeFeed([item(2), item(1)], page([9], 9, true)).map((entry) => entry.id)).toEqual([9]);
  });
  it('starts with a snapshot and commits its cursor before the next subscription', async () => {
    const { client, poll, pending } = setup();
    client.start();
    expect(poll.mock.calls[0][0]).toBeUndefined();
    pending[0].resolve(page([1, 2], 2, true));
    await vi.advanceTimersByTimeAsync(0);
    expect(client.getSnapshot().items.map((entry) => entry.id)).toEqual([2, 1]);
    expect(client.getSnapshot().status).toBe('live');
    expect(poll.mock.calls[1][0]).toEqual({ after: 2, epoch: 'test-epoch' });
    client.stop();
  });
  it('reconnects automatically from the last committed cursor and merges missed measurements once', async () => {
    const { client, poll, pending } = setup();
    client.start();
    pending[0].resolve(page([1], 1, true));
    await vi.advanceTimersByTimeAsync(0);
    pending[1].reject(new Error('network dropped'));
    await vi.advanceTimersByTimeAsync(0);
    expect(client.getSnapshot().status).toBe('reconnecting');
    expect(client.getSnapshot().online).toEqual([]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(poll.mock.calls[2][0]).toEqual({ after: 1, epoch: 'test-epoch' });
    pending[2].resolve(page([1, 2, 3]));
    await vi.advanceTimersByTimeAsync(0);
    expect(client.getSnapshot().items.map((entry) => entry.id)).toEqual([3, 2, 1]);
    expect(client.getSnapshot().status).toBe('live');
    client.stop();
  });
  it('drains multiple recovery pages before reporting live', async () => {
    const { client, pending, poll } = setup();
    client.start();
    pending[0].resolve({ ...page([1, 2]), hasMore: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(client.getSnapshot().status).toBe('reconnecting');
    expect(poll.mock.calls[1][0]?.after).toBe(2);
    pending[1].resolve(page([3, 4]));
    await vi.advanceTimersByTimeAsync(0);
    expect(client.getSnapshot().status).toBe('live');
    expect(client.getSnapshot().items.map((entry) => entry.id)).toEqual([4, 3, 2, 1]);
    client.stop();
  });
  it('shows disconnected after repeated failures and still retries', async () => {
    const { client, pending, poll } = setup();
    client.start();
    for (let i = 0; i < 3; i++) {
      pending[i].reject(new Error('offline'));
      await vi.advanceTimersByTimeAsync(0);
      if (i < 2) await vi.advanceTimersByTimeAsync(1000 * 2 ** i);
    }
    expect(client.getSnapshot().status).toBe('disconnected');
    await vi.advanceTimersByTimeAsync(4000);
    expect(poll).toHaveBeenCalledTimes(4);
    client.stop();
  });
  it('aborts an active request and ignores a late response after stopping', async () => {
    const { client, pending, poll } = setup();
    client.start();
    client.stop();
    expect(pending[0].signal.aborted).toBe(true);
    pending[0].resolve(page([99]));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(client.getSnapshot().items).toEqual([]);
    expect(poll).toHaveBeenCalledTimes(1);
  });
  it('cancels retry timers on cleanup', async () => {
    const { client, pending, poll } = setup();
    client.start();
    pending[0].reject(new Error('offline'));
    await vi.advanceTimersByTimeAsync(0);
    client.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(poll).toHaveBeenCalledTimes(1);
  });
  it('stops reconnecting on authentication failures', async () => {
    const { client, pending, poll } = setup();
    client.start();
    pending[0].reject({ status: 401 });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(client.getSnapshot().status).toBe('disconnected');
    expect(client.getSnapshot().error).toContain('sign in');
    expect(poll).toHaveBeenCalledTimes(1);
    client.stop();
  });
});
