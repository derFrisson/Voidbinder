import type { ErrorResponse } from '@voidbinder/shared/api';
import { createMiddleware } from 'hono/factory';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { AppEnv } from '../app';
import { log } from './log';

/** Cloudflare's always-passes secret (https://developers.cloudflare.com/turnstile/troubleshooting/testing/). */
export const TURNSTILE_TEST_SECRET = '1x0000000000000000000000000000000AA';

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const SITEVERIFY_TIMEOUT_MS = 5000;
/** Where the widget's token travels: this header, or a field of the JSON or form body. */
const TOKEN_FIELD = 'cf-turnstile-response';

/**
 * The Better Auth endpoints that create or mail something for an unauthenticated caller, as paths
 * below `/auth`: sign-up, the reset mail (`/forget-password` is the older name of
 * `/request-password-reset`) and the verification mail again.
 */
export const TURNSTILE_PATHS: ReadonlySet<string> = new Set([
  '/auth/sign-up/email',
  '/auth/request-password-reset',
  '/auth/forget-password',
  '/auth/send-verification-email',
]);

export interface TurnstileConfig {
  /** `TURNSTILE_SECRET`. */
  secret: string;
  /** Local development: no token needed and no call to Cloudflare (see `skipsTurnstile`). */
  skip: boolean;
  /** `TURNSTILE_NATIVE_BYPASS`: requests with an `Authorization: Bearer` header are not checked. */
  nativeBypass: boolean;
  /** Test seam for the Siteverify call. */
  fetch?: typeof fetch;
}

/** Only Cloudflare's test secret on the local environment skips the check, never a deployed one. */
export function skipsTurnstile(secret: string | undefined, importEnv: string | undefined): boolean {
  return secret === TURNSTILE_TEST_SECRET && importEnv === 'local';
}

/** The token of the request, from the header first, then the body (JSON or form); else undefined. */
async function tokenOf(req: Request): Promise<string | undefined> {
  const header = req.headers.get(TOKEN_FIELD);
  if (header) return header;
  try {
    // A clone, so Better Auth still reads the body.
    const type = req.headers.get('content-type') ?? '';
    const copy = req.clone();
    const body: unknown = type.includes('application/json')
      ? await copy.json()
      : type.includes('form')
        ? Object.fromEntries(await copy.formData())
        : undefined;
    const value = (body as Record<string, unknown> | null | undefined)?.[TOKEN_FIELD];
    return typeof value === 'string' && value ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Checks the Turnstile token of the sign-up, reset-request and resend-verification endpoints
 * (`TURNSTILE_PATHS`, POST only) with Siteverify; everything else passes. A missing, wrong,
 * spent or expired token answers 400 `turnstile_failed`; a Siteverify that cannot be reached or
 * understood answers 503 `turnstile_unavailable`, never a silent pass.
 */
export const requireTurnstile = (config: TurnstileConfig) =>
  createMiddleware<AppEnv>(async (c, next) => {
    if (c.req.method !== 'POST' || !TURNSTILE_PATHS.has(c.req.path) || config.skip) return next();
    if (config.nativeBypass && c.req.header('authorization')?.startsWith('Bearer ')) return next();

    const deny = (status: ContentfulStatusCode, code: string, message: string) => {
      const body: ErrorResponse = { error: { code, message, requestId: c.var.requestId } };
      return c.json(body, status);
    };

    const token = await tokenOf(c.req.raw);
    if (!token) return deny(400, 'turnstile_failed', 'Turnstile token missing');

    const form = new URLSearchParams({ secret: config.secret, response: token });
    const ip = c.req.header('cf-connecting-ip');
    if (ip) form.set('remoteip', ip);
    let result: { success?: unknown; 'error-codes'?: unknown };
    try {
      const res = await (config.fetch ?? fetch)(SITEVERIFY, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`Siteverify answered ${res.status}`);
      result = (await res.json()) as typeof result;
    } catch (err) {
      log('error', {
        requestId: c.var.requestId,
        message: 'turnstile siteverify unavailable',
        error: String(err),
      });
      return deny(503, 'turnstile_unavailable', 'Verification is unavailable, try again');
    }
    if (result.success !== true) {
      // The codes say why (invalid-input-response, timeout-or-duplicate, ...); the token stays out.
      log('warn', {
        requestId: c.var.requestId,
        message: 'turnstile verification failed',
        codes: result['error-codes'],
      });
      return deny(400, 'turnstile_failed', 'Turnstile verification failed');
    }
    return next();
  });
