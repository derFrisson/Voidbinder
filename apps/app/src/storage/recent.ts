import { GameSchema, type Game } from '@voidbinder/shared';
import { useMemo, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

// "Zuletzt angesehen": the last sets and cards the visitor opened, kept on the device. A small
// storage seam: the web build uses localStorage, the native builds keep it in memory until they
// get a persistent store (Sprint 3).

export type Recent =
  | { kind: 'set'; game: Game; code: string; name: string }
  // printId and lang: the print and language it was opened in (VB-108); entries stored before
  // that have neither and link to the card alone.
  | { kind: 'card'; game: Game; id: string; name: string; printId?: string; lang?: string };

export const RECENT_LIMIT = 8;
const KEY = 'voidbinder.recent';

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const memory = new Map<string, string>();
const inMemory: KeyValueStorage = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => void memory.set(key, value),
};

function deviceStorage(): KeyValueStorage {
  if (Platform.OS !== 'web') return inMemory;
  try {
    // Throws when the browser blocks storage (private mode, cookies off).
    localStorage.getItem(KEY);
    return localStorage;
  } catch {
    return inMemory;
  }
}

const same = (a: Recent, b: Recent) =>
  a.kind === b.kind &&
  a.game === b.game &&
  (a.kind === 'set' ? a.code === (b as typeof a).code : a.id === (b as typeof a).id);

/** `item` first, an earlier entry for the same set or card dropped, at most `RECENT_LIMIT`. */
export function pushRecent(list: Recent[], item: Recent): Recent[] {
  return [item, ...list.filter((r) => !same(r, item))].slice(0, RECENT_LIMIT);
}

function isRecent(v: unknown): v is Recent {
  const r = v as Partial<Record<string, unknown>> | null;
  if (!r || !GameSchema.safeParse(r.game).success || typeof r.name !== 'string') return false;
  return r.kind === 'set'
    ? typeof r.code === 'string'
    : r.kind === 'card' && typeof r.id === 'string';
}

/** A stored card with a print or language of the wrong type loses just those (hand-edited). */
function clean(r: Recent): Recent {
  if (r.kind !== 'card') return r;
  const { printId, lang, ...rest } = r;
  return {
    ...rest,
    ...(typeof printId === 'string' && { printId }),
    ...(typeof lang === 'string' && { lang }),
  };
}

/** The stored list; anything unreadable (an older shape, hand-edited) counts as empty. */
export function readRecents(storage: KeyValueStorage): Recent[] {
  try {
    const list: unknown = JSON.parse(storage.getItem(KEY) ?? '[]');
    return Array.isArray(list) ? list.filter(isRecent).slice(0, RECENT_LIMIT).map(clean) : [];
  } catch {
    return [];
  }
}

const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

/** Remember a set or card the visitor opened. */
export function recordRecent(item: Recent, storage: KeyValueStorage = deviceStorage()): void {
  try {
    storage.setItem(KEY, JSON.stringify(pushRecent(readRecents(storage), item)));
  } catch {
    return; // storage full or blocked: the row is a convenience, never an error
  }
  listeners.forEach((fn) => fn());
}

export function useRecents(): Recent[] {
  // The raw string is the snapshot (equal strings are the same snapshot); parsing waits for a change.
  const raw = useSyncExternalStore(
    subscribe,
    () => deviceStorage().getItem(KEY),
    () => null,
  );
  return useMemo(() => readRecents({ getItem: () => raw, setItem: () => undefined }), [raw]);
}
