import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../app';
import { log } from './log';

/**
 * The log level of a response: 5xx is an error, 4xx a warning, except 401, which the app's
 * session probe (`GET /me`) answers for every signed-out visitor and is the expected outcome,
 * not a problem (it filled the Workers Logs error view, 2026-10-10).
 */
export function level(status: number): 'error' | 'warn' | 'info' {
  if (status >= 500) return 'error';
  if (status >= 400 && status !== 401) return 'warn';
  return 'info';
}

/** Logs `{ts, level, requestId, method, path, status, ms, cf.colo}` once per request. */
export const accessLog = createMiddleware<AppEnv>(async (c, next) => {
  const start = Date.now();
  await next();
  const status = c.res.status;
  // `cf` exists on Workers requests only; tests and other runtimes leave it undefined.
  const { cf } = c.req.raw as { cf?: { colo?: string } };
  log(level(status), {
    requestId: c.var.requestId,
    method: c.req.method,
    path: c.req.path,
    status,
    ms: Date.now() - start,
    cf: { colo: cf?.colo },
  });
});
