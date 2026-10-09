import type { BlobStore, CardStore } from '@voidbinder/core';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { requestId } from 'hono/request-id';
import { secureHeaders } from 'hono/secure-headers';
import { accessLog } from './middleware/access-log';
import { notFound, onError } from './middleware/errors';
import { noStoreByDefault } from './middleware/headers';
import { healthRoutes } from './routes/health';

/** The platform seams one request works with (ADR 0001). */
export interface Platform {
  cardStore: CardStore;
  blobStore: BlobStore;
  /** Releases per-request resources (the database connection). */
  close(): Promise<void>;
}

export interface AppDeps {
  /** Origin of the web app; the only origin besides Expo web dev that CORS admits. */
  appUrl: string;
  /** Reported by /health: the short git sha of the deploy, "local" otherwise. */
  version: string;
  /** Called once per request; the platform is closed after the response. */
  openPlatform(): Platform;
}

export interface AppEnv {
  Variables: { platform: Platform; requestId: string };
}

/** Expo web dev server (`expo start --web`). */
const EXPO_WEB_DEV = 'http://localhost:8081';

/** Builds the API from injected dependencies, so tests need no Cloudflare bindings. */
export function createApp(deps: AppDeps) {
  return new Hono<AppEnv>()
    .use(requestId())
    .use(accessLog)
    .use(secureHeaders())
    .use(noStoreByDefault)
    .use(cors({ origin: [deps.appUrl, EXPO_WEB_DEV], credentials: true }))
    .use(async (c, next) => {
      const platform = deps.openPlatform();
      c.set('platform', platform);
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
    .notFound(notFound)
    .onError(onError);
}

export type App = ReturnType<typeof createApp>;
