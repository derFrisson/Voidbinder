# Legal pages

Impressum / Imprint and Datenschutzerklärung / Privacy policy of voidbinder.de (VB-18). German is
binding; the English pages are a courtesy translation and say so. **These are drafts for the
operator's review, not legal advice.** Every operator detail is a `[MAX: …]` placeholder.

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

| Placeholder                                                   | Where                                |
| ------------------------------------------------------------- | ------------------------------------ |
| `[MAX: Vor- und Nachname]`                                    | imprint, privacy                     |
| `[MAX: Straße Hausnummer]`                                    | imprint, privacy                     |
| `[MAX: PLZ Ort]`                                              | imprint, privacy                     |
| `[MAX: E-Mail]`                                               | imprint, privacy                     |
| `[MAX: USt-IdNr. falls vorhanden]`                            | imprint (delete the section if none) |
| `[MAX: Datenbank-Anbieter und Region, z. B. Neon, Frankfurt]` | privacy, waitlist recipients         |
| `[MAX: zuständige Landesdatenschutzbehörde]`                  | privacy, rights                      |
| `[MAX: Aufbewahrungsfrist für unbestätigte Anmeldungen]`      | privacy, waitlist storage            |

The English files use the same German placeholder text so one search finds all of them.

## Facts the text states, and where they come from

| Statement                                                         | Source                                                                  |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------- |
| No IP address or user agent stored for the waitlist               | `apps/site/src/server/waitlist/schema.ts`, `drizzle/0000_*.sql`         |
| Stored fields, 7-day confirmation link, 24 h mail window          | `schema.ts`, `handlers.ts` (`CONFIRM_TTL_MS`, `RESEND_WINDOW_MS`)       |
| Rate limit per IP at the edge, nothing stored                     | `handlers.ts` (`rateLimit`), `wrangler.jsonc` (`RL_WAITLIST`)           |
| Mails through Cloudflare Email Service                            | `wrangler.jsonc` (`send_email`), `server/waitlist/mail.ts`              |
| No cookies, no `localStorage` / `sessionStorage`, no third hosts  | `apps/site/test/legal.test.ts` on the built HTML; no such code in `src` |
| Language in the URL; `/` redirects by `Accept-Language`, unstored | `src/pages/index.ts`                                                    |
| Consent text of the form (information about beta and launch)      | `i18n/de.ts` `waitlist.consent*`                                        |

Not verifiable from the repo: Cloudflare Web Analytics (no beacon in the code yet, see below), the
signed Cloudflare DPA, the database provider, and any cookie Cloudflare's edge might add.

## Before launch

- Fill the placeholders and have the texts reviewed.
- Cloudflare Web Analytics is described but not in the code. Enable it for the hostname in the
  dashboard (or add the beacon, `static.cloudflareinsights.com`, which `legal.test.ts` already allows);
  otherwise remove the section.
- The privacy text promises storage until unsubscribe (at most 12 months after the launch mail) and a
  deletion period for unconfirmed sign-ups. The waitlist backend has no purge job: an unsubscribe keeps the
  row with status `unsubscribed`. Build the purge or change the text.
- Bump `updated` in the frontmatter of a page whenever its text changes. If the waitlist consent text
  changes, bump `WAITLIST_CONSENT_VERSION` too.
