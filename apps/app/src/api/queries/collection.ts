import type {
  Binder,
  CollectionEntry,
  CreateBinderRequest,
  EntriesQuery,
  NewEntry,
  NewWish,
  UpdateBinderRequest,
  UpdateEntryRequest,
  UpdateWishRequest,
  WishlistEntry,
  WishlistQuery,
} from '@voidbinder/shared/api';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import { api, apiUrl } from '../client';
import { read, retry } from './http';

// The collection (`/collection/**`, VB-31): binders, the have list, the wish list, the value
// summary and the owned counts the card and set pages show. Every write invalidates the whole
// `collection` key, since one entry changes the list, the summary, the binder counts and owned.

export const collectionKey = ['collection'] as const;

/** Query params as the typed client wants them: strings, unset ones left out. */
const params = (query: object) =>
  Object.fromEntries(
    Object.entries(query)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => [k, String(v)]),
  );

/** The fields a patch sets (an absent field stays as it is). */
const defined = <T extends object>(patch: T) =>
  Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>;
  };

const invalidate = (client: QueryClient) => client.invalidateQueries({ queryKey: collectionKey });

export function useBinders() {
  return useQuery({
    queryKey: [...collectionKey, 'binders'],
    queryFn: () => read(api.collection.binders.$get()),
    retry,
  });
}

export function useCreateBinder() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (json: CreateBinderRequest) => read(api.collection.binders.$post({ json })),
    onSettled: () => invalidate(client),
  });
}

export function useUpdateBinder() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...json }: UpdateBinderRequest & { id: string }) =>
      read(api.collection.binders[':id'].$patch({ param: { id }, json })),
    onSettled: () => invalidate(client),
  });
}

export function useDeleteBinder() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await api.collection.binders[':id'].$delete({ param: { id } });
      if (!res.ok) throw new Error(`API ${res.status}`);
    },
    onSettled: () => invalidate(client),
  });
}

/** New binder order; the list moves at once and moves back when the API refuses. */
export function useOrderBinders() {
  const client = useQueryClient();
  const key = [...collectionKey, 'binders'];
  return useMutation({
    mutationFn: (ids: string[]) => read(api.collection.binders.order.$put({ json: { ids } })),
    onMutate: async (ids) => {
      await client.cancelQueries({ queryKey: key });
      const before = client.getQueryData<{ binders: Binder[] }>(key);
      if (before) {
        const byId = new Map(before.binders.map((b) => [b.id, b]));
        client.setQueryData(key, {
          binders: ids.flatMap((id, position) => {
            const b = byId.get(id);
            return b ? [{ ...b, position }] : [];
          }),
        });
      }
      return { before };
    },
    onError: (_e, _ids, ctx) => ctx?.before && client.setQueryData(key, ctx.before),
    onSettled: () => invalidate(client),
  });
}

export function useEntries(query: Partial<EntriesQuery>) {
  return useQuery({
    queryKey: [...collectionKey, 'entries', params(query)],
    queryFn: () => read(api.collection.entries.$get({ query: params(query) })),
    placeholderData: keepPreviousData,
    retry,
  });
}

export function useAddEntries() {
  const client = useQueryClient();
  return useMutation({
    // The client's id makes a retried request harmless (the API is idempotent on it).
    mutationFn: (entries: NewEntry[]) =>
      read(
        api.collection.entries.$post({
          json: entries.map((e) => ({ id: crypto.randomUUID(), ...e })),
        }),
      ),
    onSettled: () => invalidate(client),
  });
}

type Snapshot = [QueryKey, unknown][];

/** Applies `change` to the matching row of every cached list page; returns the old pages. */
function patchCached<T extends { id: string }>(
  client: QueryClient,
  kind: 'entries' | 'wishlist',
  id: string,
  change: (row: T) => T,
): Snapshot {
  const snapshot = client.getQueriesData({ queryKey: [...collectionKey, kind] });
  for (const [key, data] of snapshot) {
    const page = data as { entries: T[] } | undefined;
    if (!page) continue;
    client.setQueryData(key, {
      ...page,
      entries: page.entries.map((row) => (row.id === id ? change(row) : row)),
    });
  }
  return snapshot;
}

const restore = (client: QueryClient, snapshot: Snapshot | undefined) => {
  for (const [key, data] of snapshot ?? []) client.setQueryData(key, data);
};

/**
 * Edits an entry. The list shows the change at once (the quantity stepper, every field of the
 * form) and goes back to the old row when the API refuses; the summary follows after the answer.
 */
export function useUpdateEntry() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...json }: UpdateEntryRequest & { id: string }) =>
      read(api.collection.entries[':id'].$patch({ param: { id }, json })),
    onMutate: async ({ id, ...patch }) => {
      await client.cancelQueries({ queryKey: [...collectionKey, 'entries'] });
      return {
        snapshot: patchCached<CollectionEntry>(client, 'entries', id, (row) => ({
          ...row,
          ...defined(patch),
        })),
      };
    },
    onError: (_e, _v, ctx) => restore(client, ctx?.snapshot),
    onSettled: () => invalidate(client),
  });
}

export function useDeleteEntry() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await api.collection.entries[':id'].$delete({ param: { id } });
      if (!res.ok) throw new Error(`API ${res.status}`);
    },
    onSettled: () => invalidate(client),
  });
}

export function useWishlist(query: Partial<WishlistQuery>) {
  return useQuery({
    queryKey: [...collectionKey, 'wishlist', params(query)],
    queryFn: () => read(api.collection.wishlist.$get({ query: params(query) })),
    placeholderData: keepPreviousData,
    retry,
  });
}

export function useAddWishes() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (wishes: NewWish[]) =>
      read(
        api.collection.wishlist.$post({
          json: wishes.map((w) => ({ id: crypto.randomUUID(), ...w })),
        }),
      ),
    onSettled: () => invalidate(client),
  });
}

/** Edits a wish, shown at once and rolled back when the API refuses (like `useUpdateEntry`). */
export function useUpdateWish() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...json }: UpdateWishRequest & { id: string }) =>
      read(api.collection.wishlist[':id'].$patch({ param: { id }, json })),
    onMutate: async ({ id, ...patch }) => {
      await client.cancelQueries({ queryKey: [...collectionKey, 'wishlist'] });
      return {
        snapshot: patchCached<WishlistEntry>(client, 'wishlist', id, (row) => ({
          ...row,
          ...defined(patch),
        })),
      };
    },
    onError: (_e, _v, ctx) => restore(client, ctx?.snapshot),
    onSettled: () => invalidate(client),
  });
}

export function useDeleteWish() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await api.collection.wishlist[':id'].$delete({ param: { id } });
      if (!res.ok) throw new Error(`API ${res.status}`);
    },
    onSettled: () => invalidate(client),
  });
}

/** Value panel, binder counts and values, tab counts. */
export function useCollectionSummary() {
  return useQuery({
    queryKey: [...collectionKey, 'summary'],
    queryFn: () => read(api.collection.summary.$get({ query: {} })),
    retry,
  });
}

/**
 * Copies and wishes per print for the card and set pages; nothing while signed out (`enabled`)
 * or for an empty list.
 */
export function useOwned(printIds: readonly string[], enabled = true) {
  const ids = [...printIds].sort().slice(0, 200).join(',');
  return useQuery({
    queryKey: [...collectionKey, 'owned', ids],
    queryFn: () => read(api.collection.owned.$get({ query: { printIds: ids } })),
    enabled: enabled && ids.length > 0,
    retry,
  });
}

/** The CSV download: a plain link, so the browser saves the file with the session cookie. */
export const exportCsvUrl = `${apiUrl}/collection/export.csv`;
