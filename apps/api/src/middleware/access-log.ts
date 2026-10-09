import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../app';
import { log } from './log';

/** Logs `{ts, level, requestId, method, path, status, ms, cf.colo}` once per request. */
export const accessLog = createMiddleware<AppEnv>(async (c, next) => {
  const start = Date.now();
  await next();
  const status = c.res.status;
  // `cf` exists on Workers requests only; tests and other runtimes leave it undefined.
  const { cf } = c.req.raw as { cf?: { colo?: string } };
  log(status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info', {
    requestId: c.var.requestId,
    method: c.req.method,
    path: c.req.path,
    status,
    ms: Date.now() - start,
    cf: { colo: cf?.colo },
  });
});
