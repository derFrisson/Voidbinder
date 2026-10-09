import { createMiddleware } from 'hono/factory';

/** API responses are private and dynamic unless a route says otherwise. */
export const noStoreByDefault = createMiddleware(async (c, next) => {
  await next();
  if (!c.res.headers.has('Cache-Control')) c.header('Cache-Control', 'no-store');
});
