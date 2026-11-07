import { createSeed, DB_VERSION, type Database } from './seed';

/** Minimal key-value storage so the database can run on AsyncStorage in the app and in memory in tests. */
export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const DB_KEY = 'hh.db';

let storage: KeyValueStorage | null = null;
let cache: Database | null = null;
const listeners = new Set<() => void>();

export function configureStorage(s: KeyValueStorage) {
  storage = s;
  cache = null;
}

export function memoryStorage(): KeyValueStorage {
  const map = new Map<string, string>();
  return {
    getItem: async (k) => map.get(k) ?? null,
    setItem: async (k, v) => void map.set(k, v),
    removeItem: async (k) => void map.delete(k),
  };
}

function getStorage(): KeyValueStorage {
  if (!storage) storage = memoryStorage();
  return storage;
}

export async function loadDb(): Promise<Database> {
  if (cache) return cache;
  const raw = await getStorage().getItem(DB_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Database;
      if (parsed.version === DB_VERSION) {
        cache = parsed;
        return cache;
      }
    } catch {
      // Corrupt data: fall through and reseed.
    }
  }
  cache = createSeed();
  await getStorage().setItem(DB_KEY, JSON.stringify(cache));
  return cache;
}

/** Applies a change, saves it and notifies subscribers. */
export async function mutate<T>(fn: (db: Database) => T): Promise<T> {
  const db = await loadDb();
  const result = fn(db);
  await getStorage().setItem(DB_KEY, JSON.stringify(db));
  listeners.forEach((l) => l());
  return result;
}

export async function resetDb(): Promise<void> {
  cache = createSeed();
  await getStorage().setItem(DB_KEY, JSON.stringify(cache));
  listeners.forEach((l) => l());
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
