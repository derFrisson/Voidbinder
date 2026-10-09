import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv } from '../app';
import type { AuthUser } from './index';

/**
 * Reads the session once (cookie, or `Authorization: Bearer <token>`) and puts the signed-in
 * user on `c.var.user`; answers 401 otherwise. Routes that need a user use it:
 * `new Hono<AppEnv>().use(requireUser).get(…)`.
 *
 * The user comes from the 5-minute session cookie cache when the request has one, so its
 * profile fields can be up to that old; read the `user` row when they must be fresh.
 */
export const requireUser = createMiddleware<AppEnv & { Variables: { user: AuthUser } }>(
  async (c, next) => {
    const { headers, response: session } = await c.var.auth().api.getSession({
      headers: c.req.raw.headers,
      returnHeaders: true,
    });
    if (!session) {
      throw new HTTPException(401, {
        message: 'Sign in first',
        res: new Response(null, { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } }),
      });
    }
    // A refreshed session (expiry extended, cookie cache renewed) comes with cookies; set them
    // first, so a handler that signs out (DELETE /me) has the last word.
    for (const cookie of headers.getSetCookie()) c.header('Set-Cookie', cookie, { append: true });
    c.set('user', session.user);
    await next();
  },
);
