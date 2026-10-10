import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { fakeApi, json, me, signedIn } from '../../../test/fake-api';
import { useGames } from './catalog';
import { useSession, useUpdateMe } from './me';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useSession', () => {
  it('is the signed-in user, read from GET /api/me with the cookie', async () => {
    const calls = fakeApi(signedIn);
    const { result } = renderHook(() => useSession(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(me));
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/me', credentials: 'include' });
  });

  it('is null, not an error, when the API answers 401', async () => {
    fakeApi();
    const { result } = renderHook(() => useSession(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('is an error when the API fails', async () => {
    fakeApi((c) => (c.path === '/me' ? json({ error: { code: 'internal' } }, 500) : undefined));
    const { result } = renderHook(() => useSession(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useUpdateMe', () => {
  it('PATCHes /api/me and puts the answer into the session', async () => {
    const calls = fakeApi(signedIn, (c) =>
      c.method === 'PATCH' ? json({ ...me, ...(c.body as object) }) : undefined,
    );
    const { result } = renderHook(() => ({ session: useSession(), update: useUpdateMe() }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.session.data).toEqual(me));
    result.current.update.mutate({ language: 'en' });
    await waitFor(() => expect(result.current.session.data?.language).toBe('en'));
    expect(calls.at(-1)).toMatchObject({ method: 'PATCH', path: '/me', body: { language: 'en' } });
  });
});

describe('catalog hooks', () => {
  it('useGames reads GET /api/catalog/games', async () => {
    const games = { games: [{ id: 'mtg', name: 'Magic: The Gathering', setCount: 3 }] };
    fakeApi((c) => (c.path === '/catalog/games' ? json(games) : undefined));
    const { result } = renderHook(() => useGames(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(games));
  });
});
