import type { Session, User } from '@kerf/shared';

export interface SessionStorage {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  remove(): Promise<void>;
}
interface Transport {
  login(name: string, password: string): Promise<Session>;
  me(token: string): Promise<User>;
  logout(token: string): Promise<void>;
}
interface SessionState { ready: boolean; session?: Session; message?: string }
const unauthorized = (error: unknown) => (error as { status?: number })?.status === 401;

// Platform-independent so restoration and revocation can be exercised without a device.
export class SessionClient {
  private state: SessionState = { ready: false };
  private listeners = new Set<() => void>();
  private revision = 0;
  constructor(private storage: SessionStorage, private transport: Transport) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private update(state: SessionState) {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }
  async restore() {
    const revision = ++this.revision;
    let session: Session | undefined;
    try {
      const raw = await this.storage.read();
      if (raw) {
        const saved = JSON.parse(raw) as Session;
        if (/^[a-f0-9]{64}$/.test(saved.token) && Number.isFinite(saved.expiresAt) && saved.expiresAt > Date.now() &&
            Number.isSafeInteger(saved.user?.id) && typeof saved.user?.name === 'string') {
          session = saved;
          session = { ...session, user: await this.transport.me(session.token) };
        } else {
          await this.storage.remove();
        }
      }
      if (revision === this.revision) this.update({ ready: true, session });
    } catch (error) {
      if (revision !== this.revision) return;
      if (session && !unauthorized(error)) {
        this.update({ ready: true, session, message: 'Connection unavailable. Retrying live sync…' });
      } else {
        await this.storage.remove().catch(() => {});
        this.update({ ready: true, message: unauthorized(error) ? 'Your session has ended. Please sign in again.' : 'Could not restore your session. Please sign in.' });
      }
    }
  }
  async login(name: string, password: string) {
    const session = await this.transport.login(name, password);
    try {
      await this.storage.write(JSON.stringify(session));
    } catch {
      await this.transport.logout(session.token).catch(() => {});
      throw new Error('Could not save your session. Enable storage and try again.');
    }
    ++this.revision;
    this.update({ ready: true, session });
  }
  async logout() {
    const session = this.state.session;
    if (!session) return;
    // Stay signed in if offline: do not claim server revocation until it succeeds.
    try { await this.transport.logout(session.token); }
    catch (error) { if (!unauthorized(error)) throw new Error('Could not sign out. Reconnect and try again.'); }
    ++this.revision;
    await this.storage.remove().catch(() => {});
    this.update({ ready: true });
  }
  invalidate(token: string) {
    if (this.state.session?.token !== token) return;
    ++this.revision;
    this.update({ ready: true, message: 'Your session has ended. Please sign in again.' });
    void this.storage.remove().catch(() => {});
  }
}
