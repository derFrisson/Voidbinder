import { describe, expect, it } from 'vitest';
import { orderChanges, resolvePush, type PushedStamp, type StoredStamp } from './index.js';

const t = (minute: number) => `2026-10-10T10:${String(minute).padStart(2, '0')}:00.000Z`;
const stored = (s: Partial<StoredStamp> = {}): StoredStamp => ({
  updatedAt: t(10),
  deletedAt: null,
  same: false,
  ...s,
});
const pushed = (p: Partial<PushedStamp> = {}): PushedStamp => ({
  updatedAt: t(20),
  deletedAt: null,
  baseUpdatedAt: t(10),
  ...p,
});

describe('resolvePush', () => {
  it('inserts a row the server has not got, and skips a delete of one', () => {
    expect(resolvePush(null, pushed({ baseUpdatedAt: null }))).toEqual({
      action: 'insert',
      updatedAt: t(20),
    });
    expect(resolvePush(null, pushed({ deletedAt: t(20) }))).toEqual({
      action: 'skip',
      updatedAt: t(20),
    });
  });

  it('applies an edit made on the stored row', () => {
    expect(resolvePush(stored(), pushed())).toEqual({ action: 'apply', updatedAt: t(20) });
    // A base newer than the stored row (the stored time was read at millisecond precision).
    expect(resolvePush(stored(), pushed({ baseUpdatedAt: t(11) })).action).toBe('apply');
  });

  it('never moves updatedAt back when the device clock is behind', () => {
    expect(resolvePush(stored(), pushed({ updatedAt: t(5) }))).toEqual({
      action: 'apply',
      updatedAt: '2026-10-10T10:10:00.001Z',
    });
  });

  it('keeps the server row when it changed after the device’s base', () => {
    expect(resolvePush(stored({ updatedAt: t(15) }), pushed())).toEqual({ action: 'conflict' });
    // A device that created the row offline while another pushed the same id.
    expect(resolvePush(stored(), pushed({ baseUpdatedAt: null }))).toEqual({
      action: 'conflict',
    });
  });

  it('is idempotent: a row equal to the stored one writes nothing', () => {
    expect(resolvePush(stored({ updatedAt: t(20), same: true }), pushed())).toEqual({
      action: 'noop',
      updatedAt: t(20),
    });
    expect(
      resolvePush(stored({ updatedAt: t(20), same: true }), pushed({ baseUpdatedAt: null })),
    ).toEqual({ action: 'noop', updatedAt: t(20) });
  });

  it('lets a newer delete win over an edit the device did not see', () => {
    const edited = stored({ updatedAt: t(15) });
    expect(resolvePush(edited, pushed({ deletedAt: t(20) })).action).toBe('apply');
    expect(resolvePush(edited, pushed({ updatedAt: t(12), deletedAt: t(12) }))).toEqual({
      action: 'conflict',
    });
  });

  it('resurrects a deleted row only with a newer edit', () => {
    const deleted = stored({ updatedAt: t(15), deletedAt: t(15) });
    expect(resolvePush(deleted, pushed({ updatedAt: t(20) })).action).toBe('apply');
    expect(resolvePush(deleted, pushed({ updatedAt: t(12) }))).toEqual({ action: 'conflict' });
    // The device saw the delete and edits again: that edit is newer by definition.
    expect(resolvePush(deleted, pushed({ baseUpdatedAt: t(15) })).action).toBe('apply');
  });

  it('writes nothing for a delete of a deleted row', () => {
    expect(
      resolvePush(stored({ updatedAt: t(15), deletedAt: t(15) }), pushed({ deletedAt: t(20) })),
    ).toEqual({ action: 'noop', updatedAt: t(15) });
  });
});

describe('orderChanges', () => {
  it('puts parents first and merges a table’s changes', () => {
    const order = orderChanges([
      { table: 'deck_entries', rows: [1] },
      { table: 'collection_entries', rows: [2] },
      { table: 'decks', rows: [3] },
      { table: 'binders', rows: [4] },
      { table: 'collection_entries', rows: [5] },
      { table: 'wishlist_entries', rows: [6] },
    ]);
    expect(order).toEqual([
      { table: 'binders', rows: [4] },
      { table: 'collection_entries', rows: [2, 5] },
      { table: 'wishlist_entries', rows: [6] },
      { table: 'decks', rows: [3] },
      { table: 'deck_entries', rows: [1] },
    ]);
  });
});
