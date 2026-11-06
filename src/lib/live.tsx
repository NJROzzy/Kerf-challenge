import { randomUUID } from 'expo-crypto';
import { createContext, type ReactNode, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';

import { api } from './api';
import { useSession } from './auth';
import { LiveClient } from './live-client';

const LiveContext = createContext<LiveClient | null>(null);

function ConnectedLive({ children }: { children: ReactNode }) {
  const [connectionId] = useState(() => randomUUID());
  const [client] = useState(() => new LiveClient((cursor, signal) => api.sync(connectionId, cursor, signal)));
  useEffect(() => {
    client.start();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') client.start();
      else if (Platform.OS !== 'web') { client.stop(); void api.leave(connectionId).catch(() => {}); }
    });
    const onOnline = () => client.start();
    const onPageHide = () => { client.stop(); void api.leave(connectionId).catch(() => {}); };
    if (Platform.OS === 'web') {
      globalThis.addEventListener('online', onOnline);
      globalThis.addEventListener('pagehide', onPageHide);
      globalThis.addEventListener('pageshow', onOnline);
    }
    return () => {
      client.stop();
      subscription.remove();
      if (Platform.OS === 'web') {
        globalThis.removeEventListener('online', onOnline);
        globalThis.removeEventListener('pagehide', onPageHide);
        globalThis.removeEventListener('pageshow', onOnline);
      }
      void api.leave(connectionId).catch(() => {});
    };
  }, [client, connectionId]);
  return <LiveContext value={client}>{children}</LiveContext>;
}

export function LiveProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  return session ? <ConnectedLive key={session.token}>{children}</ConnectedLive> : children;
}

export function useLive() {
  const client = useContext(LiveContext);
  if (!client) throw new Error('LiveProvider is required.');
  return { ...useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot), retry: client.start };
}
