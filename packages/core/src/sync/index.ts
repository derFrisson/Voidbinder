import { SYNC_TABLES, type SyncTable } from '@voidbinder/shared/api';

// The sync engine's pure rules (VB-32, ADR 0005), shared by the API and the native client: what a
// pushed row does to the stored one, and the order a batch is applied in.

/** A row's timestamps: the last edit, and the delete's time (ISO strings). */
export interface SyncStamp {
  updatedAt: string;
  deletedAt: string | null;
}

/**
 * What the server holds: the row (`deletedAt` null), or, for a deleted row, its entry in the
 * deletion log (`updatedAt` = `deletedAt` = the delete's time; the row itself is gone, VB-75); and
 * whether its fields already equal the pushed row's.
 */
export interface StoredStamp extends SyncStamp {
  same: boolean;
}

/** A pushed row: its edit, and the `updatedAt` the device last saw (null: it created the row). */
export interface PushedStamp extends SyncStamp {
  baseUpdatedAt: string | null;
}

export type SyncResolution =
  /**
   * Write the pushed row with this `updatedAt`: `insert` when there is no row (none stored, or
   * an edit that brings a deleted row back), `apply` over the stored row (a pushed delete removes
   * it).
   */
  | { action: 'insert' | 'apply'; updatedAt: string }
  /** Nothing to write: the stored row already is the pushed one, or both are deleted (`noop`), or a delete of a row the server never had (`skip`). */
  | { action: 'noop' | 'skip'; updatedAt: string }
  /** The server keeps its row (or its delete); the device replaces its copy (or drops it). */
  | { action: 'conflict' };

const ms = (t: string) => Date.parse(t);

/**
 * Last writer wins per row, with the server's row as authority:
 * - nothing stored: insert a row the device created (a delete of a row the server never had is
 *   skipped); an edit with a base is a conflict, its row deleted with the log entry swept;
 * - the stored row equals the pushed one, or both are deleted: nothing to do (an idempotent
 *   retry);
 * - the device saw the stored row (`stored.updatedAt <= baseUpdatedAt`): apply;
 * - else someone changed it meanwhile: a delete newer than that change still wins, an edit newer
 *   than the stored delete brings the row back (an insert, whatever the base), anything else is
 *   a conflict.
 *
 * An applied row's `updatedAt` never goes back: a device clock behind the stored edit gets the
 * stored time plus a millisecond, so the next device's base comparison still holds.
 */
export function resolvePush(stored: StoredStamp | null, pushed: PushedStamp): SyncResolution {
  if (!stored) {
    if (pushed.deletedAt) return { action: 'skip', updatedAt: pushed.updatedAt };
    // A base proves the server held the row: with no row and no log entry, the log entry of its
    // delete was swept. Only a row the device created is inserted.
    if (pushed.baseUpdatedAt !== null) return { action: 'conflict' };
    return { action: 'insert', updatedAt: pushed.updatedAt };
  }
  if (stored.same || (stored.deletedAt && pushed.deletedAt))
    return { action: 'noop', updatedAt: stored.updatedAt };
  const write = (): SyncResolution => ({
    // Only an edit reaches here over a stored delete: the row comes back.
    action: stored.deletedAt ? 'insert' : 'apply',
    updatedAt: new Date(Math.max(ms(pushed.updatedAt), ms(stored.updatedAt) + 1)).toISOString(),
  });
  // A logged delete's time may lie before the row's last edit, so a base proves nothing there: a
  // device that pulled the delete dropped its copy, a base at or after it only comes from skew.
  if (
    !stored.deletedAt &&
    pushed.baseUpdatedAt !== null &&
    ms(stored.updatedAt) <= ms(pushed.baseUpdatedAt)
  )
    return write();
  if (pushed.deletedAt && ms(pushed.deletedAt) > ms(stored.updatedAt)) return write();
  if (stored.deletedAt && !pushed.deletedAt && ms(pushed.updatedAt) > ms(stored.deletedAt))
    return write();
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
