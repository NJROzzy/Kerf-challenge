import type { FeedItem, LiveStatus, SyncPage, User } from '@kerf/shared';

interface LiveState {
  items: FeedItem[];
  online: User[];
  status: LiveStatus;
  lastSynced?: number;
  error?: string;
}
interface Cursor { after: number; epoch: string }

export function mergeFeed(previous: FeedItem[], page: SyncPage) {
  const items = new Map((page.reset ? [] : previous).map((item) => [item.id, item]));
  for (const item of page.items) items.set(item.id, item);
  return [...items.values()].sort((a, b) => b.id - a.id);
}

export class LiveClient {
  private state: LiveState = { items: [], online: [], status: 'connecting' };
  private listeners = new Set<() => void>();
  private cursor?: Cursor;
  private generation = 0;
  private abort?: AbortController;
  private retryTimer?: ReturnType<typeof setTimeout>;
  constructor(private poll: (cursor: Cursor | undefined, signal: AbortSignal) => Promise<SyncPage>) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private update(patch: Partial<LiveState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  start = () => {
    this.stop();
    const generation = this.generation;
    this.update({ status: this.cursor ? 'reconnecting' : 'connecting' });
    let failures = 0;
    const next = async () => {
      if (generation !== this.generation) return;
      this.abort = new AbortController();
      try {
        const page = await this.poll(this.cursor, this.abort.signal);
        if (generation !== this.generation) return;
        // Commit the page and its cursor together, only after the request succeeds.
        this.cursor = { after: page.cursor, epoch: page.epoch };
        this.update({ items: mergeFeed(this.state.items, page), online: page.online,
          status: page.hasMore ? 'reconnecting' : 'live', error: undefined, lastSynced: Date.now() });
        failures = 0;
        this.retryTimer = setTimeout(() => { void next(); }, 0);
      } catch (error) {
        if (generation !== this.generation) return;
        if ((error as { status?: number })?.status === 401) {
          this.update({ status: 'disconnected', online: [], error: 'Your session has ended. Please sign in again.' });
          return;
        }
        failures++;
        this.update({ status: failures < 3 ? 'reconnecting' : 'disconnected', online: [],
          error: 'Connection lost. Retrying automatically; saved measurements will catch up.' });
        const delay = Math.min(10_000, 1000 * 2 ** (failures - 1)) + Math.random() * 250;
        this.retryTimer = setTimeout(() => { void next(); }, delay);
      }
    };
    void next();
  };
  stop = () => {
    this.generation++;
    this.abort?.abort();
    clearTimeout(this.retryTimer);
    this.update({ status: 'disconnected', online: [] });
  };
}
