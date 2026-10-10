import type {
  CreateDeckRequest,
  DeckDetail,
  DeckEntry,
  DeckEntryInput,
  MissingCard,
  UpdateDeckRequest,
} from '@voidbinder/shared/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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

export function useUpdateDeck(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (json: UpdateDeckRequest) => read(api.decks[':id'].$patch({ param: { id }, json })),
    onSuccess: (deck) => client.setQueryData(deckKey(id), deck),
    onSettled: () => client.invalidateQueries({ queryKey: [...decksKey, 'list'] }),
  });
}

export function useDeleteDeck() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await api.decks[':id'].$delete({ param: { id } });
      if (!res.ok) throw new Error(`API ${res.status}`);
    },
    onSettled: () => client.invalidateQueries({ queryKey: decksKey }),
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

/**
 * Writes the deck's whole list. The new quantities show at once (the rules' verdict follows with
 * the answer) and go back when the API refuses. A line the deck had not got yet shows with the
 * answer.
 */
export function usePutEntries(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (entries: DeckEntryInput[]) =>
      read(api.decks[':id'].entries.$put({ param: { id }, json: { entries } })),
    onMutate: async (entries) => {
      await client.cancelQueries({ queryKey: deckKey(id) });
      const before = client.getQueryData<DeckDetail>(deckKey(id));
      if (before) {
        const next = new Map(entries.map((e) => [`${e.cardId}:${e.zone}`, e.quantity]));
        client.setQueryData<DeckDetail>(deckKey(id), {
          ...before,
          entries: before.entries.flatMap((e) => {
            const quantity = next.get(`${e.cardId}:${e.zone}`);
            return quantity ? [{ ...e, quantity }] : [];
          }),
        });
      }
      return { before };
    },
    onError: (_e, _v, ctx) => ctx?.before && client.setQueryData(deckKey(id), ctx.before),
    onSuccess: (deck) => client.setQueryData(deckKey(id), deck),
    onSettled: () => client.invalidateQueries({ queryKey: [...decksKey, 'list'] }),
  });
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
