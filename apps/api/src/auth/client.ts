import { createAuthClient } from 'better-auth/client';
import { inferAdditionalFields, twoFactorClient } from 'better-auth/client/plugins';
// Type-only: the server config stays out of the app bundle.
import type { Auth } from './index';

export interface ApiAuthClientOptions {
  /**
   * Native clients (no cookies): returns the session token that sign-in sent in the
   * `set-auth-token` header; it goes out as `Authorization: Bearer <token>`. The web app leaves
   * this unset and uses the session cookie.
   */
  bearerToken?: () => string | Promise<string>;
}

/**
 * Better Auth client for the app, exported as `@voidbinder/api/auth-client`. `baseURL` is the
 * auth base as the app sees it, e.g. `https://app.voidbinder.de/api/auth` behind the web app's
 * proxy or `http://localhost:8787/auth` against `wrangler dev`.
 */
export function createApiAuthClient(baseURL: string, options: ApiAuthClientOptions = {}) {
  return createAuthClient({
    baseURL,
    // A sign-in that needs the second factor answers `{ twoFactorRedirect: true }`; the caller
    // then sends the code with `twoFactor.verifyTotp` or `verifyBackupCode`.
    plugins: [inferAdditionalFields<Auth>(), twoFactorClient()],
    ...(options.bearerToken && {
      fetchOptions: { auth: { type: 'Bearer' as const, token: options.bearerToken } },
    }),
  });
}

export type ApiAuthClient = ReturnType<typeof createApiAuthClient>;
