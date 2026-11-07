import { useFocusEffect } from 'expo-router';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';

import { subscribe } from '@/api';

interface ApiState<T> {
  data: T | undefined;
  error: unknown;
  /** True only before the first result arrives; later reloads keep showing the previous data. */
  loading: boolean;
  refreshing: boolean;
  /** Pull-to-refresh: shows the spinner. */
  refresh: () => Promise<void>;
}

interface Result<T> {
  done: boolean;
  data?: T;
  error: unknown;
}

/**
 * Loads data while the screen is focused and keeps it current: reloads when `deps` change,
 * when the screen regains focus, when anything in the local database changes, and optionally on an interval.
 * `deps` must be serialisable values (ids, filters, the language code).
 */
export function useApi<T>(fetcher: () => Promise<T>, deps: unknown[], options: { pollMs?: number } = {}): ApiState<T> {
  const key = JSON.stringify(deps);
  const [result, setResult] = useState<Result<T>>({ done: false, error: null });
  const [refreshing, setRefreshing] = useState(false);
  const fetcherRef = useRef(fetcher);
  const requestId = useRef(0);

  useLayoutEffect(() => {
    fetcherRef.current = fetcher;
  });

  const load = useCallback(async () => {
    const id = ++requestId.current;
    try {
      const data = await fetcherRef.current();
      if (id === requestId.current) setResult({ done: true, data, error: null });
    } catch (error) {
      if (id === requestId.current) setResult((prev) => ({ done: true, data: prev.data, error }));
    }
  }, []);

  const { pollMs } = options;
  useFocusEffect(
    useCallback(() => {
      load();
      const unsubscribe = subscribe(() => void load());
      const timer = pollMs ? setInterval(load, pollMs) : undefined;
      return () => {
        unsubscribe();
        if (timer) clearInterval(timer);
      };
      // `key` stands in for the caller's deps.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load, pollMs, key])
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return { data: result.data, error: result.error, loading: !result.done, refreshing, refresh };
}
