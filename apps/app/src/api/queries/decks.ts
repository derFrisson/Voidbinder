import type {
  CreateDeckRequest,
  DeckDetail,
  DeckEntry,
  DeckEntryInput,
  MissingCard,
} from '@voidbinder/shared/api';
import { useMutation, useMutationState, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';
import { collectionKey } from './collection';
import { read, retry } from './http';

// Decks (`/decks/**`, VB-34). The API answers every write with the whole deck and the rules'
// verdict, so a write puts that answer into the cache instead of reading it again.

export const decksKey = ['decks'] as const;
const deckKey = (id: string) => [...decksKey, id] as const;

export function useDecks() {
  return useQuery({
    queryKey: [...decksKey, 'list'],
    queryFn: () => read(api.decks.$get({ query: {} })),
    retry,
  });
}

export function useDeck(id: string) {
  return useQuery({
    queryKey: deckKey(id),
    queryFn: () => read(api.decks[':id'].$get({ param: { id }, query: {} })),
    retry,
  });
}

/** A new deck; the caller sets `id` (kept across retries), so a retry adds nothing twice. */
export function useCreateDeck() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (json: CreateDeckRequest) => read(api.decks.$post({ json })),
    onSuccess: (deck) => client.setQueryData(deckKey(deck.id), deck),
    onSettled: () => client.invalidateQueries({ queryKey: [...decksKey, 'list'] }),
  });
}

/** The list the API takes, from the entries the deck shows. */
export const toInput = (entries: readonly DeckEntry[]): DeckEntryInput[] =>
  entries.map((e) => ({
    cardId: e.cardId,
    printId: e.printId,
    zone: e.zone,
    quantity: e.quantity,
  }));

/** A change to the deck's list, as a function of the list (adds and steps relative to it). */
export type EntriesUpdate = (entries: DeckEntry[]) => DeckEntry[];

const entriesKey = (id: string) => [...deckKey(id), 'entries'] as const;

/**
 * Changes the deck's list and writes it whole. The writes of a deck queue (`scope`) and each
 * change runs on the newest answer when its turn comes, so two quick adds both land; until then
 * `useDeckEntries` shows the list with the pending changes on top, and a refused one drops out.
 */
export function usePutEntries(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationKey: entriesKey(id),
    scope: { id: `deck-entries-${id}` },
    mutationFn: (update: EntriesUpdate) => {
      const deck = client.getQueryData<DeckDetail>(deckKey(id));
      // Never write a list built on nothing: it would replace the deck's.
      if (!deck) throw new Error('Deck not loaded');
      return read(
        api.decks[':id'].entries.$put({
          param: { id },
          json: { entries: toInput(update(deck.entries)) },
        }),
      );
    },
    onSuccess: (deck) => client.setQueryData(deckKey(id), deck),
    onSettled: () => void client.invalidateQueries({ queryKey: [...decksKey, 'list'] }),
  });
}

/** The deck's lines as they show: the API's answer with the pending changes applied in order. */
export function useDeckEntries(id: string, entries: DeckEntry[]): DeckEntry[] {
  const pending = useMutationState({
    filters: { mutationKey: entriesKey(id), status: 'pending' },
    select: (m) => m.state.variables as EntriesUpdate,
  });
  return pending.reduce((list, update) => update(list), entries);
}

/**
 * "Fehlende auf Wunschliste": one wish per missing card (its priced print, the missing copies),
 * each its own request, so a card already on the list (409) does not stop the others.
 */
export function useWishMissing() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (missing: readonly MissingCard[]) => {
      const results = await Promise.all(
        missing.flatMap((m) =>
          m.printId
            ? [
                api.collection.wishlist.$post({
                  json: {
                    id: crypto.randomUUID(),
                    printId: m.printId,
                    quantity: m.needed - m.owned,
                  },
                }),
              ]
            : [],
        ),
      );
      const failed = results.filter((r) => !r.ok && (r.status as number) !== 409);
      if (failed.length) throw new Error(`API ${failed[0]?.status}`);
      return results.length;
    },
    onSettled: () => client.invalidateQueries({ queryKey: collectionKey }),
  });
}
