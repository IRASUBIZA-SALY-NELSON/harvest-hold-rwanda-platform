import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';

import * as api from '@/api';
import { registerForPush } from '@/lib/push';

const TOKEN_KEY = 'hh.token';

// SecureStore keeps the token in the phone's encrypted storage. The web preview has no
// SecureStore, so it falls back to localStorage there (development only).
const tokenStore = {
  get: () => (Platform.OS === 'web' ? Promise.resolve(globalThis.localStorage?.getItem(TOKEN_KEY) ?? null) : SecureStore.getItemAsync(TOKEN_KEY)),
  set: (v: string) => (Platform.OS === 'web' ? Promise.resolve(globalThis.localStorage?.setItem(TOKEN_KEY, v)) : SecureStore.setItemAsync(TOKEN_KEY, v)),
  clear: () => (Platform.OS === 'web' ? Promise.resolve(globalThis.localStorage?.removeItem(TOKEN_KEY)) : SecureStore.deleteItemAsync(TOKEN_KEY)),
};

interface AuthState {
  user: api.PublicUser | null;
  ready: boolean;
  signIn: (phone: string, pin: string) => Promise<api.PublicUser>;
  register: (input: api.RegisterInput) => Promise<api.PublicUser>;
  refreshUser: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<api.PublicUser | null>(null);
  const [ready, setReady] = useState(false);

  const forget = useCallback(async () => {
    api.setToken(null);
    await tokenStore.clear();
    setUser(null);
  }, []);

  useEffect(() => {
    api.onSessionExpired(() => void forget());
    (async () => {
      try {
        const token = await tokenStore.get();
        if (token) {
          api.setToken(token);
          setUser(await api.getMe());
          registerForPush();
        }
      } catch (e) {
        // Expired session: sign out. No network: keep the token and show the sign-in screen for now.
        if (e instanceof api.ApiError && e.code === 'signedOut') await forget();
      } finally {
        setReady(true);
      }
    })();
  }, [forget]);

  const start = useCallback(async ({ token, user: u }: api.Session) => {
    api.setToken(token);
    await tokenStore.set(token);
    setUser(u);
    registerForPush();
    return u;
  }, []);

  const signIn = useCallback(async (phone: string, pin: string) => start(await api.signIn(phone, pin)), [start]);
  const register = useCallback(async (input: api.RegisterInput) => start(await api.register(input)), [start]);
  const refreshUser = useCallback(async () => setUser(await api.getMe()), []);
  const signOut = useCallback(async () => {
    await api.signOut().catch(() => {});
    await forget();
  }, [forget]);

  const value = useMemo(
    () => ({ user, ready, signIn, register, refreshUser, signOut }),
    [user, ready, signIn, register, refreshUser, signOut]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** For screens that only render when signed in. */
export function useUser(): api.PublicUser {
  const { user } = useAuth();
  if (!user) throw new Error('No signed-in user');
  return user;
}
