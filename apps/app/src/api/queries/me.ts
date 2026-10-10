import type { MeResponse, UpdateMeRequest } from '@voidbinder/shared/api';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '../client';
import { ApiError, read } from './http';

export const meKey = ['me'] as const;

/** Drops everything a signed-in user has read, so nothing of theirs outlives the session. */
export function signedOut(client: QueryClient) {
  client.clear();
  client.setQueryData(meKey, null);
}

/**
 * The signed-in user, `null` when signed out. `GET /me` checks the session in the database, so a
 * session revoked elsewhere shows up as signed out here at once.
 */
export function useSession() {
  return useQuery({
    queryKey: meKey,
    queryFn: async (): Promise<MeResponse | null> => {
      try {
        return await read(api.me.$get());
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: 60_000,
  });
}

export function useUpdateMe() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (patch: UpdateMeRequest) => read(api.me.$patch({ json: patch })),
    onSuccess: (me) => client.setQueryData(meKey, me),
  });
}

/** `DELETE /me`: requests the deletion and ends every session, so the app is signed out after. */
export function useDeleteMe() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => read(api.me.$delete()),
    onSuccess: () => signedOut(client),
  });
}
