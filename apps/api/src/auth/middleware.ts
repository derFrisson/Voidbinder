import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv } from '../app';
import type { AuthUser } from './index';

/** The 401 of every route that needs a user, with `WWW-Authenticate: Bearer`. */
export function unauthorized(): HTTPException {
  return new HTTPException(401, {
    message: 'Sign in first',
    res: new Response(null, { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } }),
  });
}

function sessionMiddleware(fresh: boolean) {
  return createMiddleware<AppEnv & { Variables: { user: AuthUser } }>(async (c, next) => {
    const { headers, response: session } = await c.var.auth().api.getSession({
      headers: c.req.raw.headers,
      query: { disableCookieCache: fresh },
      returnHeaders: true,
    });
    if (!session) throw unauthorized();
    // A refreshed session (expiry extended, cookie cache renewed) comes with cookies; set them
    // first, so a handler that signs out (DELETE /me) has the last word.
    for (const cookie of headers.getSetCookie()) c.header('Set-Cookie', cookie, { append: true });
    c.set('user', session.user);
    await next();
  });
}

/**
 * Reads the session once (cookie, or `Authorization: Bearer <token>`) and puts the signed-in
 * user on `c.var.user`; answers 401 otherwise. Routes that need a user use it:
 * `new Hono<AppEnv>().use(requireUser).get(…)`.
 *
 * The session comes from the 5-minute cookie cache when the request has one, so a revoked
 * session still passes for up to 5 minutes and the profile fields can be that old.
 */
export const requireUser = sessionMiddleware(false);

/** `requireUser` that always reads the `session` table: a revoked session fails at once. */
export const requireFreshUser = sessionMiddleware(true);
