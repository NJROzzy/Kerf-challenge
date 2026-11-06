import * as SecureStore from 'expo-secure-store';
import { createContext, type ReactNode, useContext, useEffect, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

import { api, setAuth } from './api';
import { SessionClient } from './session-client';

const KEY = 'kerf.session.v1';
const sessionClient = new SessionClient({
  read: async () => Platform.OS === 'web' ? globalThis.localStorage?.getItem(KEY) ?? null : SecureStore.getItemAsync(KEY),
  write: async (value) => {
    if (Platform.OS === 'web') globalThis.localStorage.setItem(KEY, value);
    else await SecureStore.setItemAsync(KEY, value);
  },
  remove: async () => {
    if (Platform.OS === 'web') globalThis.localStorage?.removeItem(KEY);
    else await SecureStore.deleteItemAsync(KEY);
  },
}, api);

sessionClient.subscribe(() => setAuth(sessionClient.getSnapshot().session?.token, (token) => sessionClient.invalidate(token)));
const SessionContext = createContext(sessionClient);

export function SessionProvider({ children }: { children: ReactNode }) {
  useEffect(() => { void sessionClient.restore(); }, []);
  return <SessionContext value={sessionClient}>{children}</SessionContext>;
}

export function useSession() {
  const client = useContext(SessionContext);
  return {
    ...useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot),
    signIn: (name: string, password: string) => client.login(name, password),
    signOut: () => client.logout(),
  };
}
