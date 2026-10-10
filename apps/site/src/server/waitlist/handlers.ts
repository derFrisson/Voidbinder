import {
  LocaleSchema,
  WAITLIST_CONSENT_VERSION,
  WaitlistSignupSchema,
  type Locale,
  type WaitlistSignup,
} from '@voidbinder/shared/waitlist';
import { alreadyListedMail, confirmationMail, type MailSender } from './mail';
import type { PurgeCounts, WaitlistRepository } from './repository';
import type { WaitlistSignupRow } from './schema';
import { verifyTurnstile, type TurnstileDeps } from './turnstile';

export interface WaitlistDeps {
  repo: WaitlistRepository;
  mail: MailSender;
  /** Base for links in mails, e.g. https://voidbinder.de (no trailing slash). */
  siteUrl: string;
  /** HMAC key for unsubscribe tokens (Worker secret UNSUBSCRIBE_SECRET). */
  unsubscribeSecret: string;
  /** Turnstile on the sign-up form (VB-72). */
  turnstile: TurnstileDeps;
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
/** `<row id>.<base64url HMAC-SHA256(UNSUBSCRIBE_SECRET, row id)>` */
const UNSUBSCRIBE_TOKEN_RE =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/;

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** 32 random bytes, base64url without padding (43 chars). Only its hash is stored. */
export function newToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/**
 * Unsubscribe token of a row. Derived from the row id, so every mail of a row carries the same
 * token and its links stay valid for the life of the row; nothing about it is stored.
 */
export async function unsubscribeToken(id: string, secret: string): Promise<string> {
  const mac = await crypto.subtle.sign('HMAC', await hmacKey(secret), new TextEncoder().encode(id));
  return `${id}.${base64url(new Uint8Array(mac))}`;
}

/** The row id of a genuine unsubscribe token, else null. `verify` compares in constant time. */
async function unsubscribeIdFrom(token: string | null, secret: string): Promise<string | null> {
  const match = token ? UNSUBSCRIBE_TOKEN_RE.exec(token) : null;
  if (!match?.[1] || !match[2]) return null;
  const [, id, mac] = match;
  const macBytes = Uint8Array.from(atob(mac.replace(/-/g, '+').replace(/_/g, '/')), (c) =>
    c.charCodeAt(0),
  );
  const ok = await crypto.subtle.verify(
    'HMAC',
    await hmacKey(secret),
    macBytes,
    new TextEncoder().encode(id),
  );
  return ok ? id : null;
}

/**
 * Reads the body, but never more than MAX_BODY_BYTES (null past the cap, whatever
 * Content-Length claims), and parses it as JSON or form data; {} when it does not parse.
 */
async function readBody(
  request: Pick<Request, 'body' | 'headers'>,
): Promise<Record<string, unknown> | null> {
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  if (request.body) {
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(new Uint8Array(value)); // copy: Blob wants an ArrayBuffer-backed view
    }
  }
  const body = new Blob(chunks);
  const type = request.headers.get('content-type') ?? '';
  try {
    const parsed: unknown = type.includes('application/json')
      ? JSON.parse(await body.text())
      : Object.fromEntries(
          await new Response(body, { headers: { 'content-type': type } }).formData(),
        );
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const localeOf = (value: unknown): Locale => LocaleSchema.catch(DEFAULT_LOCALE).parse(value);

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
    if (outcome.status === 429 || outcome.status === 413) {
      const init: ResponseInit =
        outcome.status === 429
          ? { status: 429, headers: { 'Retry-After': '60' } }
          : { status: outcome.status };
      return json
        ? Response.json({ error: outcome.error }, init)
        : new Response(outcome.status === 429 ? 'Too many requests' : 'Payload too large', init);
    }
    return json
      ? Response.json({ error: outcome.error }, { status: outcome.status })
      : redirect(`/${locale}/waitlist/error?reason=${outcome.error}`);
  };

  if (!(await deps.rateLimit(request.headers.get('cf-connecting-ip') ?? 'unknown'))) {
    return answer({ ok: false, status: 429, error: 'rate_limited' });
  }
  const body = await readBody(request);
  if (!body) return answer({ ok: false, status: 413, error: 'too_large' });
  locale = localeOf(body.locale);

  // Honeypot: look exactly like a success, store and send nothing.
  if (body.website !== undefined && body.website !== '') return answer({ ok: true });

  const parsed = WaitlistSignupSchema.safeParse({ ...body, locale });
  if (!parsed.success) {
    const email = parsed.error.issues.some((i) => i.path[0] === 'email');
    return answer({ ok: false, status: 400, error: email ? 'email' : 'consent' });
  }

  // After the cheap checks, so a malformed request costs no Siteverify call.
  const human = await verifyTurnstile(
    deps.turnstile,
    body['cf-turnstile-response'],
    request.headers.get('cf-connecting-ip'),
  );
  if (human === 'failed') return answer({ ok: false, status: 400, error: 'turnstile' });
  if (human === 'unavailable') {
    return answer({ ok: false, status: 503, error: 'turnstile_unavailable' });
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
  const confirmUrl = `${deps.siteUrl}/api/waitlist/confirm?token=${confirmToken}`;
  const sent = { lastConfirmationSentAt: now };
  const fresh = {
    ...sent,
    locale,
    consentTextVersion: WAITLIST_CONSENT_VERSION,
    confirmTokenHash: await hashToken(confirmToken),
    confirmExpiresAt: new Date(now.getTime() + CONFIRM_TTL_MS),
  };

  let row: WaitlistSignupRow;
  if (!existing) {
    const inserted = await deps.repo.insert({ ...fresh, email, status: 'pending', createdAt: now });
    if (!inserted) return; // a concurrent request for the same address got there first
    row = inserted;
  } else if (existing.status === 'confirmed') {
    await deps.repo.update(existing.id, sent);
    row = existing;
  } else {
    // pending (resend with a new link) or unsubscribed (fresh double opt-in)
    await deps.repo.update(existing.id, {
      ...fresh,
      status: 'pending',
      confirmedAt: null,
      unsubscribedAt: null,
    });
    row = existing;
  }
  // Same token in every mail of the row, so the links of earlier mails keep working.
  const unsubscribeUrl = `${deps.siteUrl}/api/waitlist/unsubscribe?token=${await unsubscribeToken(row.id, deps.unsubscribeSecret)}&lang=${locale}`;
  const message =
    existing?.status === 'confirmed'
      ? alreadyListedMail(locale, email, unsubscribeUrl)
      : confirmationMail(locale, email, confirmUrl, unsubscribeUrl);

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
 * GET /api/waitlist/unsubscribe?token=…&lang=… (the link in the mail) changes nothing: link
 * scanners prefetch GET links, so it only forwards to the site's page with one button, which
 * POSTs the token back.
 */
export function handleUnsubscribeLink(request: Request): Response {
  const query = new URL(request.url).searchParams;
  const next = new URLSearchParams({ token: query.get('token') ?? '' });
  return redirect(`/${localeOf(query.get('lang'))}/waitlist/unsubscribe?${next}`);
}

/**
 * POST /api/waitlist/unsubscribe: the page's form (`token=…` in the body, answers 303) or the
 * RFC 8058 one-click request of a mail client (body `List-Unsubscribe=One-Click`, token in the
 * query, answers 200). Idempotent; an unknown, tampered or malformed token gets the same answer
 * and changes nothing, since that address is not subscribed.
 */
export async function handleUnsubscribe(request: Request, deps: WaitlistDeps): Promise<Response> {
  const now = deps.now?.() ?? new Date();
  const body = await readBody(request);
  if (!body) return new Response('Payload too large', { status: 413 });
  const query = new URL(request.url).searchParams;
  const token = typeof body.token === 'string' ? body.token : query.get('token');
  const id = await unsubscribeIdFrom(token, deps.unsubscribeSecret);
  const row = id ? await deps.repo.findById(id) : null;
  if (row && row.status !== 'unsubscribed') {
    await deps.repo.update(row.id, { status: 'unsubscribed', unsubscribedAt: now });
  }
  if (body['List-Unsubscribe'] === 'One-Click')
    return new Response('Unsubscribed', { status: 200 });
  const locale = row?.locale ?? localeOf(body.lang ?? query.get('lang'));
  return redirect(`/${locale}/waitlist/unsubscribed`);
}

/** True for an RFC 8058 one-click unsubscribe POST; reads a clone, the request stays unread. */
export async function isOneClickUnsubscribe(request: Request): Promise<boolean> {
  if (request.method !== 'POST' || new URL(request.url).pathname !== '/api/waitlist/unsubscribe')
    return false;
  return (await readBody(request.clone()))?.['List-Unsubscribe'] === 'One-Click';
}

export const DEFAULT_PENDING_RETENTION_DAYS = 30;
export const DEFAULT_UNSUBSCRIBED_RETENTION_DAYS = 365;

export interface RetentionDeps {
  repo: WaitlistRepository;
  /** Raw `vars` values; anything but a positive whole number falls back to the default. */
  pendingDays?: unknown;
  unsubscribedDays?: unknown;
  now?(): Date;
  log?(message: string, ...rest: unknown[]): void;
  warn?(message: string, ...rest: unknown[]): void;
}

function retentionDays(raw: unknown, fallback: number, name: string, warn: RetentionDeps['warn']) {
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (typeof n === 'number' && Number.isInteger(n) && n > 0) return n;
  if (raw !== undefined) warn?.(`[waitlist] ${name}=${String(raw)} is invalid, using ${fallback}`);
  else warn?.(`[waitlist] ${name} is not set, using ${fallback}`);
  return fallback;
}

/**
 * Scheduled retention purge (VB-47): unconfirmed sign-ups whose confirmation link expired more
 * than `pendingDays` ago and unsubscribed rows older than `unsubscribedDays` are deleted.
 * Confirmed rows stay until the beta-start mail (docs/site/waitlist.md).
 */
export async function purgeExpired(deps: RetentionDeps): Promise<PurgeCounts> {
  const now = (deps.now?.() ?? new Date()).getTime();
  const days = (raw: unknown, fallback: number, name: string) =>
    retentionDays(raw, fallback, name, deps.warn);
  const counts = await deps.repo.deleteExpired({
    pendingBefore: new Date(
      now -
        days(deps.pendingDays, DEFAULT_PENDING_RETENTION_DAYS, 'WAITLIST_PENDING_RETENTION_DAYS') *
          DAY_MS,
    ),
    unsubscribedBefore: new Date(
      now -
        days(
          deps.unsubscribedDays,
          DEFAULT_UNSUBSCRIBED_RETENTION_DAYS,
          'WAITLIST_UNSUBSCRIBED_RETENTION_DAYS',
        ) *
          DAY_MS,
    ),
  });
  deps.log?.('[waitlist] retention purge', counts);
  return counts;
}
