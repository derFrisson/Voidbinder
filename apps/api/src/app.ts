import type { BlobStore, CardStore } from '@voidbinder/core';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { requestId } from 'hono/request-id';
import { secureHeaders } from 'hono/secure-headers';
import { createAuth, type Auth, type AuthConfig } from './auth';
import { accessLog } from './middleware/access-log';
import { notFound, onError } from './middleware/errors';
import { noStoreByDefault } from './middleware/headers';
import { healthRoutes } from './routes/health';
import { meRoutes } from './routes/me';

/** The platform seams one request works with (ADR 0001). */
export interface Platform {
  cardStore: CardStore;
  blobStore: BlobStore;
  /** Drizzle on the cache-disabled pool (ADR 0004): auth, profile, everything read after a write. */
  db: NodePgDatabase;
  /** Releases per-request resources (the database connection). */
  close(): Promise<void>;
}

export interface AppDeps {
  /** Origin of the web app (`APP_URL`); CORS and Better Auth admit it. */
  appUrl: string;
  /** Further origins CORS and Better Auth admit (`CORS_EXTRA_ORIGINS`: Expo web dev, never prod). */
  extraOrigins: string[];
  /** Reported by /health: the short git sha of the deploy, "local" otherwise. */
  version: string;
  /** Better Auth settings (src/auth); the origins come from `appUrl` and `extraOrigins`. */
  auth: Pick<AuthConfig, 'secret' | 'apiUrl' | 'mail'>;
  /** Called once per request; the platform is closed after the response. */
  openPlatform(): Platform;
}

export interface AppEnv {
  Variables: {
    platform: Platform;
    requestId: string;
    /** Better Auth for this request, built on first use (src/auth). */
    auth: () => Auth;
  };
}

/** `waitUntil` of the request; `app.request` in tests has no ExecutionContext, so run inline. */
function waitUntil(c: Context<AppEnv>, promise: Promise<unknown>): void {
  try {
    c.executionCtx.waitUntil(promise);
  } catch {
    // The promise runs anyway; its errors are handled by whoever made it.
  }
}

/** Builds the API from injected dependencies, so tests need no Cloudflare bindings. */
export function createApp(deps: AppDeps) {
  const origins = [deps.appUrl, ...deps.extraOrigins];
  const authConfig: AuthConfig = { ...deps.auth, appUrl: deps.appUrl, trustedOrigins: origins };
  return (
    new Hono<AppEnv>()
      .use(requestId())
      .use(accessLog)
      .use(secureHeaders())
      .use(noStoreByDefault)
      .use(cors({ origin: origins, credentials: true }))
      .use(async (c, next) => {
        const platform = deps.openPlatform();
        c.set('platform', platform);
        let auth: Auth | undefined;
        c.set('auth', () => {
          auth ??= createAuth(authConfig, { db: platform.db, waitUntil: (p) => waitUntil(c, p) });
          return auth;
        });
        try {
          await next();
        } finally {
          const closing = platform.close();
          // ponytail: `app.request` in tests has no ExecutionContext, so close inline there.
          try {
            c.executionCtx.waitUntil(closing);
          } catch {
            await closing;
          }
        }
      })
      .route('/health', healthRoutes(deps.version))
      // Better Auth: sign-up, sign-in, sign-out, verification, password reset (README.md).
      .on(['GET', 'POST'], '/auth/*', (c) => c.var.auth().handler(c.req.raw))
      .route('/me', meRoutes())
      .notFound(notFound)
      .onError(onError)
  );
}

export type App = ReturnType<typeof createApp>;
