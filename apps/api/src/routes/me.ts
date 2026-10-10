import { zValidator } from '@hono/zod-validator';
import {
  BanlistImpactQuerySchema,
  UpdateMeRequestSchema,
  type BanlistImpactResponse,
  type DeleteMeResponse,
  type MeResponse,
} from '@voidbinder/shared/api';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppEnv } from '../app';
import { requireFreshUser, unauthorized } from '../auth/middleware';
import { user } from '../db/schema/auth';
import { throwOnInvalid } from '../middleware/errors';
import { banlistSince } from './catalog';

function toMe(row: typeof user.$inferSelect): MeResponse {
  return {
    id: row.id,
    email: row.email,
    emailVerified: row.emailVerified,
    name: row.name,
    displayName: row.displayName,
    language: row.language as MeResponse['language'],
    currency: row.currency as MeResponse['currency'],
    trainingDataOptIn: row.trainingDataOptIn,
    deletionRequestedAt: row.deletionRequestedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * `GET /me`, `PATCH /me`, `DELETE /me`, `GET /me/banlist-impact`. They check the session in the database (not the cookie
 * cache), so a revoked session fails here at once, and read and write the `user` row directly, so
 * a PATCH shows up on the next GET at once.
 */
export function meRoutes() {
  return (
    new Hono<AppEnv>()
      .use(requireFreshUser)
      .get('/', async (c) => {
        const [row] = await c.var.platform.db.select().from(user).where(eq(user.id, c.var.user.id));
        if (!row) throw unauthorized();
        return c.json(toMe(row), 200);
      })
      .patch('/', zValidator('json', UpdateMeRequestSchema, throwOnInvalid), async (c) => {
        const [row] = await c.var.platform.db
          .update(user)
          .set({ ...c.req.valid('json'), updatedAt: new Date() })
          .where(eq(user.id, c.var.user.id))
          .returning();
        if (!row) throw unauthorized();
        return c.json(toMe(row), 200);
      })
      // VB-81: the collection's and the decks' cards the ban list touches, read fresh.
      .get(
        '/banlist-impact',
        zValidator('query', BanlistImpactQuerySchema, throwOnInvalid),
        async (c) => {
          const body: BanlistImpactResponse = await c.var.platform.cardStore.banlistImpact(
            c.var.user.id,
            c.req.valid('query'),
            banlistSince(),
          );
          return c.json(body, 200);
        },
      )
      .delete('/', async (c) => {
        // Stub until VB-45: the request is recorded and every session ends; the purge job that
        // deletes the account and its data after the grace period comes with VB-45.
        const deletionRequestedAt = new Date();
        await c.var.platform.db
          .update(user)
          .set({ deletionRequestedAt, updatedAt: deletionRequestedAt })
          .where(eq(user.id, c.var.user.id));
        const auth = c.var.auth();
        await (await auth.$context).internalAdapter.deleteUserSessions(c.var.user.id);
        // Sign-out clears the cookies of this client (its session is already gone).
        const { headers } = await auth.api.signOut({
          headers: c.req.raw.headers,
          returnHeaders: true,
        });
        for (const cookie of headers.getSetCookie())
          c.header('Set-Cookie', cookie, { append: true });
        const body: DeleteMeResponse = { deletionRequestedAt: deletionRequestedAt.toISOString() };
        return c.json(body, 202);
      })
  );
}
