import { SYNC_TABLES, type SyncTable } from '@voidbinder/shared/api';

// The sync engine's pure rules (VB-32, ADR 0005), shared by the API and the native client: what a
// pushed row does to the stored one, and the order a batch is applied in.

/** A row's timestamps: the last edit and the tombstone (ISO strings). */
export interface SyncStamp {
  updatedAt: string;
  deletedAt: string | null;
}

/** The stored row, and whether its fields already equal the pushed row's. */
export interface StoredStamp extends SyncStamp {
  same: boolean;
}

/** A pushed row: its edit, and the `updatedAt` the device last saw (null: it created the row). */
export interface PushedStamp extends SyncStamp {
  baseUpdatedAt: string | null;
}

export type SyncResolution =
  /** Write the pushed row with this `updatedAt` (`insert`: there is no stored row). */
  | { action: 'insert' | 'apply'; updatedAt: string }
  /** Nothing to write: the stored row already is the pushed one (`noop`), or a delete of a row the server never had (`skip`). */
  | { action: 'noop' | 'skip'; updatedAt: string }
  /** The server keeps its row; the device replaces its copy with it. */
  | { action: 'conflict' };

const ms = (t: string) => Date.parse(t);

/**
 * Last writer wins per row, with the server's row as authority:
 * - no stored row: insert it (a delete of a row the server never had is skipped);
 * - the stored row equals the pushed one, or both are deleted: nothing to do (an idempotent
 *   retry);
 * - the device saw the stored row (`stored.updatedAt <= baseUpdatedAt`): apply;
 * - else someone changed it meanwhile: a delete newer than that change still wins, an edit newer
 *   than the stored delete resurrects the row, anything else is a conflict.
 *
 * An applied row's `updatedAt` never goes back: a device clock behind the stored edit gets the
 * stored time plus a millisecond, so the next device's base comparison still holds.
 */
export function resolvePush(stored: StoredStamp | null, pushed: PushedStamp): SyncResolution {
  if (!stored) return { action: pushed.deletedAt ? 'skip' : 'insert', updatedAt: pushed.updatedAt };
  if (stored.same || (stored.deletedAt && pushed.deletedAt))
    return { action: 'noop', updatedAt: stored.updatedAt };
  const apply = (): SyncResolution => ({
    action: 'apply',
    updatedAt: new Date(Math.max(ms(pushed.updatedAt), ms(stored.updatedAt) + 1)).toISOString(),
  });
  if (pushed.baseUpdatedAt !== null && ms(stored.updatedAt) <= ms(pushed.baseUpdatedAt))
    return apply();
  if (pushed.deletedAt && ms(pushed.deletedAt) > ms(stored.updatedAt)) return apply();
  if (stored.deletedAt && !pushed.deletedAt && ms(pushed.updatedAt) > ms(stored.deletedAt))
    return apply();
  return { action: 'conflict' };
}

/**
 * A batch in apply order: one change per table, binders before the entries that sit in them,
 * decks before their entries; rows keep their order within a table.
 */
export function orderChanges<C extends { table: SyncTable; rows: readonly unknown[] }>(
  changes: readonly C[],
): C[] {
  const merged = new Map<SyncTable, C>();
  for (const c of changes) {
    const seen = merged.get(c.table);
    merged.set(c.table, seen ? { ...seen, rows: [...seen.rows, ...c.rows] } : c);
  }
  return SYNC_TABLES.flatMap((t) => merged.get(t) ?? []);
}
