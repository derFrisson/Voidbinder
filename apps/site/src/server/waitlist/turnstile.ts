/** Cloudflare's always-passes secret (https://developers.cloudflare.com/turnstile/troubleshooting/testing/). */
export const TURNSTILE_TEST_SECRET = '1x0000000000000000000000000000000AA';

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TIMEOUT_MS = 5000;
/** Siteverify codes that blame our configuration, not the user's token. */
const OUR_FAULT = ['missing-input-secret', 'invalid-input-secret', 'internal-error'];

export interface TurnstileDeps {
  /** Worker secret `TURNSTILE_SECRET`. */
  secret: string;
  /** Local development (`skipsTurnstile`): no token needed, no call to Cloudflare. */
  skip: boolean;
  /** Test seam for the Siteverify call. */
  fetch?: typeof fetch;
}

/** Only Cloudflare's test secret on a localhost `SITE_URL` skips the check, never a deployed Worker. */
export function skipsTurnstile(secret: string | undefined, siteUrl: string): boolean {
  return secret === TURNSTILE_TEST_SECRET && new URL(siteUrl).hostname === 'localhost';
}

/**
 * Checks a widget token with Siteverify. `failed`: no token, or Cloudflare says no (wrong, spent
 * or expired); `unavailable`: Siteverify could not be reached or understood, or rejects our own
 * secret, which never passes.
 */
export async function verifyTurnstile(
  deps: TurnstileDeps,
  token: unknown,
  ip: string | null,
): Promise<'ok' | 'failed' | 'unavailable'> {
  if (deps.skip) return 'ok';
  if (typeof token !== 'string' || !token) return 'failed';
  const form = new URLSearchParams({ secret: deps.secret, response: token });
  if (ip) form.set('remoteip', ip);
  try {
    const res = await (deps.fetch ?? fetch)(SITEVERIFY, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Siteverify answered ${res.status}`);
    const result = (await res.json()) as { success?: unknown; 'error-codes'?: unknown };
    if (result.success === true) return 'ok';
    const codes = result['error-codes'];
    // A missing or wrong secret fails every visitor alike: an outage, not a failed check.
    if (Array.isArray(codes) && codes.some((code) => OUR_FAULT.includes(code))) {
      console.error('[waitlist] turnstile siteverify rejected our configuration', codes);
      return 'unavailable';
    }
    // The codes say why (invalid-input-response, timeout-or-duplicate, ...); the token stays out.
    console.warn('[waitlist] turnstile verification failed', codes);
    return 'failed';
  } catch (err) {
    console.error('[waitlist] turnstile siteverify unavailable', err);
    return 'unavailable';
  }
}
