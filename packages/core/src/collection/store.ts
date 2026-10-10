import type {
  Binder,
  BinderOrderRequest,
  CollectionEntry,
  CollectionSummary,
  CreateBinderRequest,
  Currency,
  EntriesQuery,
  EntriesResponse,
  NewEntryData,
  NewWishData,
  OwnedResponse,
  UpdateBinderRequest,
  UpdateEntryRequest,
  UpdateWishRequest,
  WishlistEntry,
  WishlistQuery,
  WishlistResponse,
} from '@voidbinder/shared/api';

/** One line of the CSV export (Cardmarket-style columns). */
export interface ExportRow {
  name: string;
  setCode: string;
  number: string;
  language: string;
  condition: string;
  finish: string;
  quantity: number;
}

/**
 * The signed-in user's collection (VB-31): binders, entries, wishes. Every method is scoped to
 * `userId`; a row of another user, a deleted row or an unknown print or binder rejects with a
 * not-found error, a taken binder name with a conflict. Deletes leave a tombstone (`deleted_at`),
 * and reads never return one.
 */
export interface CollectionStore {
  listBinders(userId: string): Promise<Binder[]>;
  createBinder(userId: string, req: CreateBinderRequest): Promise<Binder>;
  updateBinder(userId: string, id: string, patch: UpdateBinderRequest): Promise<Binder>;
  /** The binder's entries move to no binder. */
  deleteBinder(userId: string, id: string): Promise<void>;
  orderBinders(userId: string, req: BinderOrderRequest): Promise<Binder[]>;

  listEntries(
    userId: string,
    query: EntriesQuery & { currency: Currency },
    pageSize: number,
  ): Promise<EntriesResponse>;
  /** Idempotent on `id`: an id that exists already adds nothing and answers the stored row. */
  createEntries(
    userId: string,
    entries: NewEntryData[],
    currency: Currency,
  ): Promise<CollectionEntry[]>;
  updateEntry(
    userId: string,
    id: string,
    patch: UpdateEntryRequest,
    currency: Currency,
  ): Promise<CollectionEntry>;
  deleteEntry(userId: string, id: string): Promise<void>;

  listWishes(
    userId: string,
    query: WishlistQuery & { currency: Currency },
    pageSize: number,
  ): Promise<WishlistResponse>;
  createWishes(userId: string, wishes: NewWishData[], currency: Currency): Promise<WishlistEntry[]>;
  updateWish(
    userId: string,
    id: string,
    patch: UpdateWishRequest,
    currency: Currency,
  ): Promise<WishlistEntry>;
  deleteWish(userId: string, id: string): Promise<void>;

  summary(userId: string, currency: Currency): Promise<CollectionSummary>;
  owned(userId: string, printIds: readonly string[]): Promise<OwnedResponse>;
  /** Every live entry, in batches (by id). */
  exportRows(userId: string): AsyncIterable<ExportRow[]>;
}
