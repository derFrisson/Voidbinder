import { describe, expect, it } from 'vitest';
import {
  RECENT_LIMIT,
  pushRecent,
  readRecents,
  recordRecent,
  type KeyValueStorage,
  type Recent,
} from './recent';

const set = (code: string): Recent => ({ kind: 'set', game: 'mtg', code, name: code });
const card = (id: string): Recent => ({ kind: 'card', game: 'mtg', id, name: id });

function memory(initial?: string): KeyValueStorage & { value: string | null } {
  const store = {
    value: initial ?? null,
    getItem: () => store.value,
    setItem: (_key: string, value: string) => void (store.value = value),
  };
  return store;
}

describe('recent items', () => {
  it('puts the newest first and moves a repeat to the front', () => {
    expect(pushRecent([set('a'), set('b')], set('b'))).toEqual([set('b'), set('a')]);
  });

  it('keeps a set and a card with the same key apart, and a game apart', () => {
    expect(pushRecent([card('a')], set('a'))).toHaveLength(2);
    expect(pushRecent([set('a')], { ...set('a'), game: 'pokemon' })).toHaveLength(2);
  });

  it('keeps the last 8', () => {
    let list: Recent[] = [];
    for (let i = 0; i < 12; i++) list = pushRecent(list, set(`s${i}`));
    expect(list).toHaveLength(RECENT_LIMIT);
    expect(list[0]).toEqual(set('s11'));
  });

  it('is empty for unreadable storage and drops malformed entries', () => {
    expect(readRecents(memory())).toEqual([]);
    expect(readRecents(memory('not json'))).toEqual([]);
    expect(readRecents(memory('{"a":1}'))).toEqual([]);
    expect(readRecents(memory(JSON.stringify([set('a'), { kind: 'set' }, 7, null])))).toEqual([
      set('a'),
    ]);
  });

  it('records into the storage it is given, and survives a storage that throws', () => {
    const storage = memory();
    recordRecent(set('a'), storage);
    recordRecent(card('c1'), storage);
    expect(readRecents(storage)).toEqual([card('c1'), set('a')]);
    const broken: KeyValueStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(() => recordRecent(set('b'), broken)).not.toThrow();
  });
});
