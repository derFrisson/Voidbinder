import {
  LocaleSchema,
  WAITLIST_CONSENT_VERSION,
  WaitlistSignupSchema,
  type Locale,
  type WaitlistSignup,
} from '@voidbinder/shared/waitlist';
import { alreadyListedMail, confirmationMail, type MailMessage, type MailSender } from './mail';
import type { WaitlistRepository } from './repository';
import type { WaitlistSignupRow } from './schema';

export interface WaitlistDeps {
  repo: WaitlistRepository;
  mail: MailSender;
  /** Base for links in mails, e.g. https://voidbinder.de (no trailing slash). */
  siteUrl: string;
  /** False when the caller is over the limit. */
  rateLimit(key: string): Promise<boolean>;
  now?(): Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;
export const CONFIRM_TTL_MS = 7 * DAY_MS;
/** A pending or confirmed address gets at most one mail per window, however often it signs up. */
export const RESEND_WINDOW_MS = DAY_MS;
const DEFAULT_LOCALE: Locale = 'de';
const MAX_BODY_BYTES = 8 * 1024;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** 32 random bytes, base64url without padding (43 chars). Only its hash is stored. */
export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function redirect(path: string): Response {
  return new Response(null, { status: 303, headers: { Location: path } });
}

type Outcome = { ok: true } | { ok: false; status: number; error: string };

/** POST /api/waitlist */
export async function handleSignup(request: Request, deps: WaitlistDeps): Promise<Response> {
  const type = request.headers.get('content-type') ?? '';
  const json = type.includes('application/json');
  if (
    !json &&
    !type.includes('application/x-www-form-urlencoded') &&
    !type.includes('multipart/form-data')
  ) {
    return Response.json({ error: 'content-type' }, { status: 415 });
  }

  let locale = DEFAULT_LOCALE;
  const answer = (outcome: Outcome): Response => {
    if (outcome.ok)
      return json ? Response.json({ status: 'pending' }) : redirect(`/${locale}/waitlist/pending`);
    if (outcome.status === 429) {
      return json
        ? Response.json(
            { error: 'rate_limited' },
            { status: 429, headers: { 'Retry-After': '60' } },
          )
        : new Response('Too many requests', { status: 429, headers: { 'Retry-After': '60' } });
    }
    return json
      ? Response.json({ error: outcome.error }, { status: outcome.status })
      : redirect(`/${locale}/waitlist/error?reason=${outcome.error}`);
  };

  if (!(await deps.rateLimit(request.headers.get('cf-connecting-ip') ?? 'unknown'))) {
    return answer({ ok: false, status: 429, error: 'rate_limited' });
  }
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
    return answer({ ok: false, status: 400, error: 'email' });
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = json
      ? await request.json()
      : Object.fromEntries(await request.formData());
    body = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    body = {};
  }
  locale = LocaleSchema.catch(DEFAULT_LOCALE).parse(body.locale);

  // Honeypot: look exactly like a success, store and send nothing.
  if (body.website !== undefined && body.website !== '') return answer({ ok: true });

  const parsed = WaitlistSignupSchema.safeParse({ ...body, locale });
  if (!parsed.success) {
    const email = parsed.error.issues.some((i) => i.path[0] === 'email');
    return answer({ ok: false, status: 400, error: email ? 'email' : 'consent' });
  }

  try {
    await signUp(parsed.data, deps);
  } catch (err) {
    console.error('[waitlist] sign-up failed', err);
    return answer({ ok: false, status: 500, error: 'server' });
  }
  return answer({ ok: true });
}

async function signUp({ email, locale }: WaitlistSignup, deps: WaitlistDeps): Promise<void> {
  const now = deps.now?.() ?? new Date();
  const existing = await deps.repo.findByEmail(email);
  const previousSentAt = existing?.lastConfirmationSentAt ?? null;

  if (existing && existing.status !== 'unsubscribed') {
    if (previousSentAt && now.getTime() - previousSentAt.getTime() < RESEND_WINDOW_MS) return;
  }

  const confirmToken = newToken();
  const unsubscribeToken = newToken();
  const confirmUrl = `${deps.siteUrl}/api/waitlist/confirm?token=${confirmToken}`;
  const unsubscribeUrl = `${deps.siteUrl}/api/waitlist/unsubscribe?token=${unsubscribeToken}`;
  // Only hashes are stored, so every mail carries a fresh unsubscribe token; older links stop working.
  const tokens = {
    unsubscribeTokenHash: await hashToken(unsubscribeToken),
    lastConfirmationSentAt: now,
  };
  const fresh = {
    ...tokens,
    locale,
    consentTextVersion: WAITLIST_CONSENT_VERSION,
    confirmTokenHash: await hashToken(confirmToken),
    confirmExpiresAt: new Date(now.getTime() + CONFIRM_TTL_MS),
  };

  let row: WaitlistSignupRow;
  let message: MailMessage;
  if (!existing) {
    const inserted = await deps.repo.insert({ ...fresh, email, status: 'pending', createdAt: now });
    if (!inserted) return; // a concurrent request for the same address got there first
    row = inserted;
    message = confirmationMail(locale, email, confirmUrl, unsubscribeUrl);
  } else if (existing.status === 'confirmed') {
    await deps.repo.update(existing.id, tokens);
    row = existing;
    message = alreadyListedMail(locale, email, unsubscribeUrl);
  } else {
    // pending (resend with a new link) or unsubscribed (fresh double opt-in)
    await deps.repo.update(existing.id, {
      ...fresh,
      status: 'pending',
      confirmedAt: null,
      unsubscribedAt: null,
    });
    row = existing;
    message = confirmationMail(locale, email, confirmUrl, unsubscribeUrl);
  }

  try {
    await deps.mail.send(message);
  } catch (err) {
    // Let the next attempt send again instead of waiting out the resend window.
    await deps.repo.update(row.id, { lastConfirmationSentAt: previousSentAt }).catch(() => {});
    throw err;
  }
}

function tokenFrom(request: Request): string | null {
  const token = new URL(request.url).searchParams.get('token');
  return token && TOKEN_RE.test(token) ? token : null;
}

/** GET /api/waitlist/confirm?token=… */
export async function handleConfirm(request: Request, deps: WaitlistDeps): Promise<Response> {
  const now = deps.now?.() ?? new Date();
  const token = tokenFrom(request);
  const row = token ? await deps.repo.findByConfirmTokenHash(await hashToken(token)) : null;
  if (!row) return redirect(`/${DEFAULT_LOCALE}/waitlist/expired`);
  if (row.status === 'confirmed') return redirect(`/${row.locale}/waitlist/confirmed`);
  if (row.status === 'pending' && row.confirmExpiresAt > now) {
    await deps.repo.update(row.id, { status: 'confirmed', confirmedAt: now });
    return redirect(`/${row.locale}/waitlist/confirmed`);
  }
  return redirect(`/${row.locale}/waitlist/expired`);
}

/**
 * GET /api/waitlist/unsubscribe?token=… (link) and POST (RFC 8058 one-click from the mail
 * client). Idempotent; an unknown token answers the same, since that address is not subscribed.
 */
export async function handleUnsubscribe(request: Request, deps: WaitlistDeps): Promise<Response> {
  const now = deps.now?.() ?? new Date();
  const token = tokenFrom(request);
  const row = token ? await deps.repo.findByUnsubscribeTokenHash(await hashToken(token)) : null;
  if (row && row.status !== 'unsubscribed') {
    await deps.repo.update(row.id, { status: 'unsubscribed', unsubscribedAt: now });
  }
  if (request.method === 'POST') return new Response('Unsubscribed', { status: 200 });
  return redirect(`/${row?.locale ?? DEFAULT_LOCALE}/waitlist/unsubscribed`);
}
