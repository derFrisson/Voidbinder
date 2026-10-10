import { createApiClient } from '@voidbinder/api/client';
import { createApiAuthClient } from '@voidbinder/api/auth-client';
import { Platform } from 'react-native';

/**
 * Base URL of the API. On the web the app's own Worker proxies `/api/*` to the API (first-party
 * cookies), so the default is the same origin. `pnpm dev` points it at `wrangler dev` of the API
 * (`EXPO_PUBLIC_API_URL=http://localhost:8787`); native builds (Sprint 3) set an absolute URL.
 */
const configured = process.env.EXPO_PUBLIC_API_URL ?? '/api';

/** Absolute, because Better Auth's client refuses a relative base URL. */
export const apiUrl =
  Platform.OS === 'web' && configured.startsWith('/')
    ? `${globalThis.location.origin}${configured}`
    : configured;

// The only two places that talk to the API; every read goes through a hook in ./queries.
export const api = createApiClient(apiUrl, { init: { credentials: 'include' } });
export const authClient = createApiAuthClient(`${apiUrl}/auth`, {});
