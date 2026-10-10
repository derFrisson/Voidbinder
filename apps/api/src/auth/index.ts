import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import type { Locale } from '@voidbinder/shared';
import { betterAuth, type BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthMiddleware, isAPIError } from 'better-auth/api';
import { bearer, TWO_FACTOR_ERROR_CODES, twoFactor } from 'better-auth/plugins';
import { and, eq, isNotNull } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../db/schema/auth';
import { log } from '../middleware/log';
import { authMail, negotiateLocale, type MailSender } from './mail';
import { secretCipher, withEncryptedTotpSecret } from './two-factor';

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
  /** `TWO_FACTOR_ENCRYPTION_KEY`, 32 bytes in base64: encrypts the 2FA secrets at rest. */
  twoFactorKey: string;
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
  '/two-factor/verify-totp': { window: 60, max: 5 },
  '/two-factor/verify-backup-code': { window: 60, max: 5 },
} as const;

/** "Dieses Gerät 30 Tage merken": the trusted-device cookie skips the 2FA challenge this long. */
const TRUST_DEVICE_SECONDS = 30 * 24 * 60 * 60;

/** The requests that end with a new signed-in session (after the 2FA challenge, if any). */
const SIGN_IN_PATHS = new Set([
  '/sign-in/email',
  '/two-factor/verify-totp',
  '/two-factor/verify-backup-code',
]);

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

  const cipher = secretCipher(config.twoFactorKey);

  return betterAuth({
    appName: 'Voidbinder',
    secret: config.secret,
    baseURL: config.apiUrl,
    basePath: '/auth',
    trustedOrigins: config.trustedOrigins,
    database: withEncryptedTotpSecret(drizzleAdapter(req.db, { provider: 'pg', schema }), cipher),
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
    // Order matters for the after hooks: twoFactor first, so the hooks after it see a sign-in
    // that waits for its second factor as one without a session (`newSession` null), and bearer
    // exposes no token of the session twoFactor discarded.
    plugins: [
      twoFactor({
        issuer: 'Voidbinder',
        totpOptions: { digits: 6, period: 30 },
        backupCodeOptions: {
          amount: 10,
          storeBackupCodes: { encrypt: cipher.encrypt, decrypt: cipher.decrypt },
        },
        // The first code from the authenticator app turns 2FA on, not the enable call.
        skipVerificationOnEnable: false,
        trustDeviceMaxAge: TRUST_DEVICE_SECONDS,
      }),
      voidbinderHooks(req.db),
      bearer(),
    ],
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

/**
 * - Signing in again withdraws a deletion request (DELETE /me), like Discord: every new session is
 *   a sign-in, since sign-up waits for the verified address. Only once the second factor passed,
 *   so the password alone cannot withdraw it.
 * - A wrong backup code answers like a wrong TOTP code (401 `INVALID_CODE`), so the answer does
 *   not tell which factor an attacker is guessing.
 */
function voidbinderHooks(db: NodePgDatabase) {
  return {
    id: 'voidbinder',
    hooks: {
      after: [
        {
          matcher: (ctx) => SIGN_IN_PATHS.has(ctx.path ?? ''),
          handler: createAuthMiddleware(async (ctx) => {
            const userId = ctx.context.newSession?.user.id;
            if (!userId) return;
            await db
              .update(schema.user)
              .set({ deletionRequestedAt: null, updatedAt: new Date() })
              .where(and(eq(schema.user.id, userId), isNotNull(schema.user.deletionRequestedAt)));
          }),
        },
        {
          matcher: (ctx) => ctx.path === '/two-factor/verify-backup-code',
          handler: createAuthMiddleware(async (ctx) => {
            const returned: unknown = ctx.context.returned;
            if (
              isAPIError(returned) &&
              (returned.body as { code?: string } | undefined)?.code === 'INVALID_BACKUP_CODE'
            ) {
              throw APIError.from('UNAUTHORIZED', TWO_FACTOR_ERROR_CODES.INVALID_CODE);
            }
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}

export type Auth = ReturnType<typeof createAuth>;
export type AuthUser = Auth['$Infer']['Session']['user'];
