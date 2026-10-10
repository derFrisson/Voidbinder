# Legal pages

Impressum / Imprint and Datenschutzerklärung / Privacy policy of voidbinder.de (VB-18). German is
binding; the English pages are a courtesy translation and say so. **These are drafts for the
operator's review, not legal advice.** The operator details were filled in on 2026-10-09 (Max's data); no `[MAX: …]` placeholder remains, and `legal.test.ts` fails if one comes back.

| Page              | German             | English        |
| ----------------- | ------------------ | -------------- |
| Imprint (§ 5 DDG) | `/de/impressum/`   | `/en/imprint/` |
| Privacy (Art. 13) | `/de/datenschutz/` | `/en/privacy/` |

## Where things live

- Text: `apps/site/src/content/legal/<locale>/<slug>.md`, a content collection
  (`apps/site/src/content.config.ts`) with `title`, `description` and `updated` (`YYYY-MM`) in the
  frontmatter. The body starts at `##`; the layout renders the `h1` and "Stand: / Last updated:".
- Layout: `components/Legal.astro` (65ch centered prose column inside `layouts/Base.astro`), route
  `pages/[locale]/[slug].astro` (one route, four paths).
- Slugs differ per locale, so `i18n/index.ts` has `legalSlugs` / `legalPath`, and `localePath` (language
  switch, `hreflang`) maps the slug along with the prefix. The footer links through `legalPath`.
- `astro.config.mjs` redirects the other locale's slug (`/en/datenschutz/` to `/en/privacy`, and so on,
  written to `_redirects`), because the waitlist consent text links `/<locale>/datenschutz/`.

## Placeholders

Search the repo for `[MAX:` before launch. The set is fixed in `src/content/legal/legal.test.ts`;
a missing or misspelled one fails `pnpm test`.

| Placeholder                                                            | Where                                 |
| ---------------------------------------------------------------------- | ------------------------------------- |
| `[MAX: Vor- und Nachname]`                                             | imprint, privacy                      |
| `[MAX: Straße Hausnummer]`                                             | imprint, privacy                      |
| `[MAX: PLZ Ort]`                                                       | imprint, privacy                      |
| `[MAX: E-Mail]`                                                        | imprint, privacy                      |
| `[MAX: Telefon oder weiterer Kontaktweg]`                              | imprint (optional second channel)     |
| `[MAX: USt-IdNr. falls vorhanden]`                                     | imprint (delete the section if none)  |
| `[MAX: Datenbank-Anbieter und Region, z. B. Neon, Frankfurt]`          | privacy, waitlist recipients          |
| `[MAX: zuständige Landesdatenschutzbehörde]`                           | privacy, rights                       |
| `[MAX: Aufbewahrungsfrist für unbestätigte Anmeldungen]`               | privacy, waitlist storage             |
| `[MAX: Aufbewahrungsfrist abgemeldeter Adressen, Vorschlag 12 Monate]` | privacy, waitlist after unsubscribing |
| `[MAX: Speicherdauer Cloudflare-Logs]`                                 | privacy, hosting and server logs      |

The English files use the same German placeholder text so one search finds all of them.

## Facts the text states, and where they come from

| Statement                                                                                                                                                                                              | Source                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No IP address or user agent stored for the waitlist                                                                                                                                                    | `apps/site/src/server/waitlist/schema.ts`, `drizzle/0000_*.sql`                                                                                                                                                       |
| Stored fields, 7-day confirmation link, 24 h mail window                                                                                                                                               | `schema.ts`, `handlers.ts` (`CONFIRM_TTL_MS`, `RESEND_WINDOW_MS`)                                                                                                                                                     |
| Rate limit per IP at the edge, nothing stored                                                                                                                                                          | `handlers.ts` (`rateLimit`), `wrangler.jsonc` (`RL_WAITLIST`)                                                                                                                                                         |
| Mails through Cloudflare Email Service                                                                                                                                                                 | `wrangler.jsonc` (`send_email`), `server/waitlist/mail.ts`                                                                                                                                                            |
| Website: no cookies, nothing written to `localStorage` / `sessionStorage`; third hosts only Turnstile and Plausible                                                                                    | `apps/site/test/legal.test.ts` on the built HTML; no such code in `src`                                                                                                                                               |
| Language in the URL; `/` redirects by `Accept-Language`, unstored                                                                                                                                      | `src/pages/index.ts`                                                                                                                                                                                                  |
| Purpose and storage of the waitlist = the consent text: the address is stored to tell the person when the beta starts                                                                                  | `i18n/de.ts` `waitlist.consent*`                                                                                                                                                                                      |
| Unsubscribe keeps the row (`unsubscribed`, email, timestamps) until the retention purge deletes it; a new sign-up starts a fresh double opt-in                                                         | `handlers.ts`, `docs/site/waitlist.md`                                                                                                                                                                                |
| Plausible at `web-analytics.voidcom.app` on website and web app, no cookies; the tracker only reads `localStorage.plausible_ignore`; the web app strips query and hash                                 | VB-74: `apps/site/src/layouts/Base.astro` + `wrangler.jsonc` `PLAUSIBLE_HOST` (PR #64), `apps/app/src/analytics.ts` + `package.json` `EXPO_PUBLIC_PLAUSIBLE_HOST` (PR #65); salt and hash: `plausible.io/data-policy` |
| Turnstile on sign-up, password reset request, resend of the confirmation mail and the waitlist; token and IP go to Siteverify, nothing stored, only the error codes logged                             | `apps/api/src/middleware/turnstile.ts`, `apps/site/src/server/waitlist/turnstile.ts`                                                                                                                                  |
| Account fields, scrypt password hash (Better Auth default), training-data opt-in only stored                                                                                                           | `apps/api/src/db/schema/auth.ts`, `apps/api/src/auth/index.ts`                                                                                                                                                        |
| Rate-limit counters by IP in the database (3 sign-ups, 5 sign-ins, 5 2FA codes per minute)                                                                                                             | `apps/api/src/auth/index.ts` (`AUTH_RATE_LIMITS`, `rateLimit.storage`)                                                                                                                                                |
| Sessions 7 days with IP and user agent; cookie cache 5 min, so other devices sign out within 5 min (`requireUser`); secure httpOnly cookies; trusted device 30 days; links 1 h; reset revokes sessions | `apps/api/src/auth/index.ts`, `apps/api/src/auth/middleware.ts`                                                                                                                                                       |
| 2FA secret and 10 backup codes AES-256-GCM encrypted                                                                                                                                                   | `apps/api/src/auth/two-factor.ts`, `auth/index.ts` (`twoFactor`)                                                                                                                                                      |
| Web app `localStorage`: recently viewed cards, email until first sign-in for the training opt-in                                                                                                       | `apps/app/src/storage/recent.ts`, `apps/app/src/api/queries/auth.ts`                                                                                                                                                  |
| Mails from hello@voidbinder.de via Cloudflare Email Service                                                                                                                                            | `apps/api/wrangler.jsonc` (`send_email`), `apps/api/src/auth/mail.ts`                                                                                                                                                 |
| Collection, binders, wishlist, decks with soft delete; sync without a device ID, client clock for push                                                                                                 | `apps/api/src/db/schema/collection.ts`, `decks.ts`, `routes/collection.ts`; sync: `routes/sync.ts` + `drizzle/0008_sync.sql` (VB-32, main 750d6ac)                                                                    |
| Account deletion stores the request and ends all sessions; purge after the grace period is VB-45                                                                                                       | `apps/api/src/routes/me.ts` (`DELETE /me`)                                                                                                                                                                            |
| Access log fields (request ID, method, path without query, status, ms, colo), Workers Logs on                                                                                                          | `apps/api/src/middleware/access-log.ts`, `apps/api/wrangler.jsonc` (`observability`)                                                                                                                                  |
| R2 buckets in the EU; OVH Gravelines database, Backblaze B2 EU Central backups and their retention                                                                                                     | `apps/api/wrangler.jsonc` (`jurisdiction: "eu"`), `docs/guides/database-vps.md`                                                                                                                                       |

Not verifiable from the repo: the signed Cloudflare DPA, Cloudflare's retention for its own edge logs
(the docs give no number, hence `[MAX: Speicherdauer Cloudflare-Logs]`), the database provider, and any
cookie Cloudflare's edge might add.

## Before launch

- Fill the placeholders and have the texts reviewed.
- The privacy text describes Plausible, not Cloudflare Web Analytics: deploy it only together with or
  after VB-74 (Plausible live, the site built without `PUBLIC_CF_ANALYTICS_TOKEN`).
- The privacy text promises deletion of a confirmed sign-up after the beta-start mail, of an unconfirmed
  one after `[MAX: Aufbewahrungsfrist für unbestätigte Anmeldungen]` and of an unsubscribed row after
  `[MAX: Aufbewahrungsfrist abgemeldeter Adressen, …]`, and deletion on request. A daily Cron Trigger
  purges the unconfirmed and unsubscribed rows (VB-47, [waitlist.md](waitlist.md#retention-purge)); the
  confirmed rows go with the one-off SQL documented there after the beta-start mail. Fill the two
  placeholders with 30 days / 12 months or other values and set `WAITLIST_PENDING_RETENTION_DAYS` /
  `WAITLIST_UNSUBSCRIBED_RETENTION_DAYS` in `apps/site/wrangler.jsonc` (every environment) to the same
  numbers (defaults 30 and 365). The unconfirmed clock starts when the 7-day confirmation link expires,
  so "30 days" means 37 days after sign-up; word the placeholder that way ("30 Tagen nach Ablauf des
  Bestätigungslinks") or set the var to the figure you want to state minus 7. Once the Worker is deployed, check that the cron ran
  (`wrangler tail` or Workers Logs show `[waitlist] retention purge`).
- Bump `updated` in the frontmatter of a page whenever its text changes. If the waitlist consent text
  changes, bump `WAITLIST_CONSENT_VERSION` too.
