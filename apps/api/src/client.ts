import { hc, type ClientRequestOptions } from 'hono/client';
// Import from app.ts, not index.ts: the client's types must not pull in Workers globals.
import type { App } from './app';

export type ApiClient = ReturnType<typeof hc<App>>;

/**
 * Typed client for the API: `createApiClient(url).health.$get()`. Pass
 * `{ init: { credentials: 'include' } }` once routes need the auth cookie.
 */
export function createApiClient(baseUrl: string, options?: ClientRequestOptions): ApiClient {
  return hc<App>(baseUrl, options);
}
