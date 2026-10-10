import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { I18nProvider } from '../src/i18n';
import { setFetch } from './fetch';

export type Call = {
  method: string;
  path: string;
  body: unknown;
  headers: Headers;
  credentials: RequestCredentials | undefined;
};
type Route = (call: Call) => Response | undefined;

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export const me = {
  id: 'u1',
  email: 'ada@example.test',
  emailVerified: true,
  name: 'Ada Lovelace',
  displayName: null,
  language: 'de',
  currency: 'EUR',
  trainingDataOptIn: false,
  deletionRequestedAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
} as const;

/**
 * Replaces fetch with an in-memory API: `routes` answer by method and path (relative to `/api`),
 * anything unanswered is the API's 401 for `/me` and 404 otherwise. Returns the recorded calls.
 */
export function fakeApi(...routes: Route[]): Call[] {
  const calls: Call[] = [];
  setFetch(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const text = await request.text();
    const call: Call = {
      method: request.method,
      path: url.pathname.replace(/^\/api/, '') + url.search,
      body: text ? JSON.parse(text) : undefined,
      headers: request.headers,
      credentials: init?.credentials ?? (input instanceof Request ? input.credentials : undefined),
    };
    calls.push(call);
    for (const route of routes) {
      const response = route(call);
      if (response) return response;
    }
    return call.path === '/me'
      ? json({ error: { code: 'unauthorized', message: 'Sign in first', requestId: 'r' } }, 401)
      : json({ error: { code: 'not_found', message: 'Not found', requestId: 'r' } }, 404);
  });
  return calls;
}

export const signedIn: Route = (c) =>
  c.method === 'GET' && c.path === '/me' ? json(me) : undefined;

export function renderApp(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>{ui}</I18nProvider>
    </QueryClientProvider>,
  );
}
