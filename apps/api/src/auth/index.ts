import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import type { Locale } from '@voidbinder/shared';
import { betterAuth } from 'better-auth';
import { bearer } from 'better-auth/plugins';
import { and, eq, isNotNull } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../db/schema/auth';
import { log } from '../middleware/log';
import { authMail, negotiateLocale, type MailSender } from './mail';

/** Settings that are fixed per deployment (vars and secrets of the Worker). */
export interface AuthConfig {
  /** `BETTER_AUTH_SECRET`, 32+ bytes. */
  secret: string;
  /** Public origin of this API (`API_URL`); Better Auth lives under `${apiUrl}/auth`. */
  apiUrl: string;
  /** Origin of the web app (`APP_URL`); mail links point at its `/verify` and `/reset-password`. */
  appUrl: string;
  /** Origins whose browser requests Better Auth accepts: `APP_URL` plus `CORS_EXTRA_ORIGINS`. */
  trustedOrigins: string[];
  mail: MailSender;
}

/** Per-request parts: the cache-disabled database (ADR 0004) and the Worker's `waitUntil`. */
export interface AuthRequest {
  db: NodePgDatabase;
  waitUntil(promise: Promise<unknown>): void;
}

/**
 * Attempts per client IP (`cf-connecting-ip`) and window in seconds, counted in the `rate_limit`
 * table so every isolate sees the same count. Paths not listed keep Better Auth's defaults.
 */
export const AUTH_RATE_LIMITS = {
  '/sign-up/email': { window: 60, max: 3 },
  '/sign-in/email': { window: 60, max: 5 },
} as const;

/** Verification and reset links live this long; the mail copy says "one hour". */
const LINK_TTL_SECONDS = 60 * 60;

/**
 * Better Auth for one request. The instance is cheap to build and must be per request anyway,
 * because the database pool is (Hyperdrive pools at the edge, `createPlatform`).
 */
export function createAuth(config: AuthConfig, req: AuthRequest) {
  // Mails are not awaited (Better Auth's advice against timing attacks); waitUntil keeps the
  // Worker alive until they are out.
  const sendMail = (kind: 'verify' | 'resetPassword', user: { email: string }, url: string) => {
    const locale = (user as { language?: Locale }).language ?? 'de';
    req.waitUntil(
      config.mail
        .send(authMail(kind, locale, user.email, url))
        .catch((err: unknown) =>
          log('error', { message: `auth mail "${kind}" failed`, error: String(err) }),
        ),
    );
  };

  return betterAuth({
    appName: 'Voidbinder',
    secret: config.secret,
    baseURL: config.apiUrl,
    basePath: '/auth',
    trustedOrigins: config.trustedOrigins,
    database: drizzleAdapter(req.db, { provider: 'pg', schema }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 10,
      resetPasswordTokenExpiresIn: LINK_TTL_SECONDS,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, token }) => {
        sendMail(
          'resetPassword',
          user,
          `${config.appUrl}/reset-password?token=${encodeURIComponent(token)}`,
        );
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      expiresIn: LINK_TTL_SECONDS,
      sendVerificationEmail: async ({ user, token }) => {
        sendMail('verify', user, `${config.appUrl}/verify?token=${encodeURIComponent(token)}`);
      },
    },
    user: {
      // The profile (GET/PATCH /me). Never set through Better Auth's own endpoints.
      additionalFields: {
        displayName: { type: 'string', required: false, input: false },
        language: { type: 'string', required: true, defaultValue: 'de', input: false },
        currency: { type: 'string', required: true, defaultValue: 'EUR', input: false },
        trainingDataOptIn: { type: 'boolean', required: true, defaultValue: false, input: false },
        deletionRequestedAt: { type: 'date', required: false, input: false },
      },
    },
    // Better Auth's own log lines as JSON lines like the rest of the API (level warn and up).
    logger: {
      disableColors: true,
      log: (level, message, ...args) =>
        log(level === 'debug' ? 'info' : level, {
          message,
          source: 'better-auth',
          ...(args.length > 0 && {
            details: args.map((a) => (a instanceof Error ? String(a) : a)),
          }),
        }),
    },
    databaseHooks: {
      session: {
        create: {
          // Signing in again withdraws a deletion request (DELETE /me), like Discord: every new
          // session is a sign-in, since sign-up waits for the verified address.
          after: async (session) => {
            await req.db
              .update(schema.user)
              .set({ deletionRequestedAt: null, updatedAt: new Date() })
              .where(
                and(eq(schema.user.id, session.userId), isNotNull(schema.user.deletionRequestedAt)),
              );
          },
        },
      },
      user: {
        create: {
          // The mail language starts as the browser's (Accept-Language), German otherwise.
          before: async (user, ctx) => ({
            data: {
              ...user,
              language: negotiateLocale(
                ctx?.request?.headers.get('accept-language') ??
                  ctx?.headers?.get('accept-language'),
              ),
            },
          }),
        },
      },
    },
    session: {
      // Signed copy of the session in a cookie for 5 minutes, so most requests skip the
      // database; the `session` table stays the source of truth.
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      customRules: { ...AUTH_RATE_LIMITS, '/get-session': false },
    },
    plugins: [bearer()],
    advanced: {
      useSecureCookies: true,
      defaultCookieAttributes: { httpOnly: true, secure: true, sameSite: 'lax', path: '/' },
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
      // The schema is migrated with drizzle-kit and tested; checking it would cost a query on
      // every request, since the instance is per request.
      database: { validateSchema: false },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type AuthUser = Auth['$Infer']['Session']['user'];
