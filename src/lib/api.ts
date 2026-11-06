import type { FeedItem, Group, Measurement, NewMeasurement, Project, Session, SyncPage, Unit, User } from '@kerf/shared';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

const API_PORT = 4000;
let token: string | undefined;
let onInvalid: (token: string) => void = () => {};
export function setAuth(sessionToken: string | undefined, invalid: (token: string) => void) {
  token = sessionToken;
  onInvalid = invalid;
}

function apiUrl() {
  if (process.env.EXPO_PUBLIC_API_URL) return process.env.EXPO_PUBLIC_API_URL.replace(/\/$/, '');
  const host = Platform.OS === 'web' ? globalThis.location?.hostname : Constants.expoConfig?.hostUri?.split(':')[0];
  return `http://${host || 'localhost'}:${API_PORT}`;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function request<T>(path: string, init: RequestInit = {}, options: { token?: string; public?: boolean; timeout?: number; text?: boolean } = {}): Promise<T> {
  const usedToken = options.public ? undefined : options.token ?? token;
  const controller = new AbortController();
  const abort = () => controller.abort();
  init.signal?.addEventListener('abort', abort);
  if (init.signal?.aborted) controller.abort();
  const timer = setTimeout(abort, options.timeout ?? 12_000);
  try {
    const res = await fetch(apiUrl() + path, {
      ...init, signal: controller.signal,
      headers: {
        ...(usedToken ? { authorization: `Bearer ${usedToken}` } : {}),
        'content-type': 'application/json', ...init.headers,
      },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      if (res.status === 401 && usedToken) onInvalid(usedToken);
      throw new ApiError(res.status, body.error ?? 'Request failed. Please try again.');
    }
    if (res.status === 204) return undefined as T;
    return options.text ? await res.text() as T : await res.json() as T;
  } catch (error) {
    if (error instanceof ApiError || init.signal?.aborted) throw error;
    throw new Error(controller.signal.aborted
      ? 'Request timed out. Check your connection and try again.'
      : 'Cannot reach Kerf. Check your connection and try again.');
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener('abort', abort);
  }
}

export const api = {
  login: (name: string, password: string) => request<Session>('/auth/login', {
    method: 'POST', body: JSON.stringify({ name, password }),
  }, { public: true }),
  me: (token: string) => request<User>('/me', {}, { token }),
  logout: (token: string) => request<void>('/auth/logout', { method: 'POST' }, { token }),
  projects: () => request<Project[]>('/projects'),
  measurements: (projectId: number) => request<Group[]>(`/projects/${projectId}/measurements`),
  addMeasurement: (groupId: number, measurement: NewMeasurement) => request<Measurement>(`/groups/${groupId}/measurements`, {
    method: 'POST', body: JSON.stringify(measurement),
  }),
  feed: () => request<FeedItem[]>('/feed'),
  sync: (connectionId: string, cursor: { after: number; epoch: string } | undefined, signal: AbortSignal) => {
    const query = new URLSearchParams({ connectionId });
    if (cursor) { query.set('after', String(cursor.after)); query.set('epoch', cursor.epoch); }
    return request<SyncPage>(`/sync?${query}`, { signal }, { timeout: 30_000 });
  },
  leave: (connectionId: string) => request<void>(`/presence/${connectionId}`, { method: 'DELETE', keepalive: Platform.OS === 'web' }),
  exportCsv: (unit: Unit, projectId?: number) => request<string>(
    `${projectId === undefined ? '' : `/projects/${projectId}`}/export.csv?unit=${unit}`, {}, { text: true },
  ),
  reset: () => request<{ ok: true }>('/dev/reset', { method: 'POST' }),
};
