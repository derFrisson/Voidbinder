import type { HealthResponse } from '@voidbinder/shared/api';
import { Hono } from 'hono';
import type { AppEnv } from '../app';
import { log } from '../middleware/log';

/** `GET /health`: 200 when the database answers, 503 `degraded` when it does not. */
export function healthRoutes(version: string) {
  return new Hono<AppEnv>().get('/', async (c) => {
    const db = await c.var.platform.cardStore.ping().then(
      () => 'ok' as const,
      (err: unknown) => {
        log('error', {
          requestId: c.var.requestId,
          message: 'database ping failed',
          error: String(err),
        });
        return 'error' as const;
      },
    );
    const body: HealthResponse = { status: db === 'ok' ? 'ok' : 'degraded', db, version };
    return db === 'ok' ? c.json(body, 200) : c.json(body, 503);
  });
}
