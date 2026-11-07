'use client';

import { useRouter } from 'next/navigation';
import { createContext, type ReactNode, useContext, useEffect } from 'react';

import { useQuery } from '@/lib/api';

export type Role = 'superadmin' | 'support' | 'operations' | 'market' | 'operator';

export interface Me {
  id: string;
  email: string;
  name: string;
  role: Role;
  must_change_password: boolean;
  /** Cold room operators: the rooms assigned to them. Everyone else: null (all rooms). */
  roomIds: string[] | null;
}

const MeContext = createContext<Me | null>(null);

/** Loads the signed-in admin; sends them back to the right sign-in step if needed. */
export function AdminProvider({ children }: { children: ReactNode }) {
  const me = useQuery<Me>('auth/me');
  const router = useRouter();
  useEffect(() => {
    if (!me.data) return;
    if (me.data.must_change_password) router.replace('/login/password');
  }, [me.data, router]);
  if (!me.data || me.data.must_change_password) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-ink-3">Loading…</div>;
  }
  return <MeContext.Provider value={me.data}>{children}</MeContext.Provider>;
}

export function useMe(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error('useMe outside AdminProvider');
  return me;
}

/** Whether the signed-in admin's role allows an action (superadmin always can). */
export function useCan() {
  const me = useMe();
  return (...roles: Role[]) => me.role === 'superadmin' || roles.includes(me.role);
}
