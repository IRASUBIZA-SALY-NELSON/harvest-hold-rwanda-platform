'use client';

import { createContext, type ReactNode, useCallback, useContext, useEffect, useEffectEvent, useRef, useState } from 'react';

export type LiveEvent =
  | { type: 'reading'; roomId: string; reading: any }
  | { type: 'alert'; roomId?: string; userId: string; alertType: string; params: any }
  | { type: 'incident'; roomId: string; incidentType: string; state: 'open' | 'closed' }
  | { type: 'command'; roomId: string; commandId: number; status: string }
  | { type: 'order'; orderId: string; status: string }
  | { type: 'audit'; id: number; action: string; actor: string; summary: string };

type Listener = (e: LiveEvent) => void;

const LiveContext = createContext<{ connected: boolean; subscribe: (fn: Listener) => () => void; lastEventAt: number | null }>({
  connected: false,
  subscribe: () => () => {},
  lastEventAt: null,
});

/**
 * One live connection per tab (Server-Sent Events from the API, through the portal server).
 * Pages subscribe to what they need. The browser reconnects by itself if the line drops.
 */
export function LiveProvider({ children }: { children: ReactNode }) {
  const listeners = useRef(new Set<Listener>());
  const [connected, setConnected] = useState(false);
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);

  useEffect(() => {
    const es = new EventSource('/api/admin/stream');
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    const handle = (msg: MessageEvent) => {
      try {
        const e = JSON.parse(msg.data) as LiveEvent;
        setLastEventAt(Date.now());
        listeners.current.forEach((fn) => fn(e));
      } catch {
        /* ignore */
      }
    };
    for (const t of ['reading', 'alert', 'incident', 'order', 'audit']) es.addEventListener(t, handle);
    es.addEventListener('ping', () => setConnected(true));
    return () => es.close();
  }, []);

  const subscribe = useCallback((fn: Listener) => {
    listeners.current.add(fn);
    return () => void listeners.current.delete(fn);
  }, []);

  return <LiveContext.Provider value={{ connected, subscribe, lastEventAt }}>{children}</LiveContext.Provider>;
}

export const useLive = () => useContext(LiveContext);

/** Calls fn for every live event (fn may change between renders). */
export function useLiveEvents(fn: Listener) {
  const { subscribe } = useLive();
  const onEvent = useEffectEvent(fn);
  useEffect(() => subscribe((e) => onEvent(e)), [subscribe]);
}
