import type { Locale } from '@voidbinder/shared';
import type {
  CreateDeckData,
  Currency,
  DeckDetail,
  DeckEntryInput,
  DeckSummary,
  UpdateDeckRequest,
} from '@voidbinder/shared/api';

/** What a deck read needs from the user: the price source's currency, the names' language. */
export interface DeckReadOptions {
  currency: Currency;
  lang: Locale;
}

/**
 * The signed-in user's decks (VB-34). Every method is scoped to `userId`; another user's deck, a
 * deleted one, an unknown card or print rejects with a not-found error, a format or zone the
 * game has not got with a bad-request error. A delete removes the deck and its list and logs its
 * id for sync (VB-75). Every read runs the rules (`analyzeDeck`) against the user's collection
 * and the current prices.
 */
export interface DeckStore {
  list(userId: string, opts: DeckReadOptions): Promise<DeckSummary[]>;
  get(userId: string, id: string, opts: DeckReadOptions): Promise<DeckDetail>;
  /** Idempotent on `id`: an id the user has already answers the stored deck. */
  create(userId: string, req: CreateDeckData, opts: DeckReadOptions): Promise<DeckDetail>;
  update(
    userId: string,
    id: string,
    patch: UpdateDeckRequest,
    opts: DeckReadOptions,
  ): Promise<DeckDetail>;
  delete(userId: string, id: string): Promise<void>;
  /** Replaces every entry of the deck. */
  putEntries(
    userId: string,
    id: string,
    entries: DeckEntryInput[],
    opts: DeckReadOptions,
  ): Promise<DeckDetail>;
}
