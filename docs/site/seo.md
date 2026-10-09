# SEO, link previews, analytics and security headers

What voidbinder.de tells search engines and link previews, what it measures, and which headers
every response carries (VB-19). The site URL lives in one place: `site` in
`apps/site/astro.config.mjs`; canonical, hreflang, Open Graph, JSON-LD, the sitemap and
`robots.txt` all read it.

## Per-page metadata

`src/components/Seo.astro`, rendered by `layouts/Base.astro` in every page's `<head>`. A page passes
`title` and `description` to `<Base>` (both default to the locale's `meta` copy) and `noindex` for
error pages. Seo emits:

- `<title>`, `meta description`, `robots noindex` on error pages;
- `canonical` (`https://voidbinder.de/<path>`), `hreflang` `de` / `en` (the same path with the other
  locale prefix) and `x-default` (`/`, the language redirect, for the two start pages; the German
  page otherwise);
- Open Graph: `og:type`, `og:site_name`, `og:title`, `og:description`, `og:url`, `og:locale`
  (`de_DE` / `en_US`), `og:locale:alternate`, `og:image` (+ type, 1200×630, alt);
- Twitter `summary_large_image` with title, description and image;
- `theme-color` `#F4F6FB` (light) and `#0A0F1E` (dark), per `prefers-color-scheme`;
- JSON-LD `@graph` with an `Organization` (name, URL, GitHub) and a `SoftwareApplication`
  (`creativeWorkStatus: Pre-alpha`, AGPL licence, free; no offers, prices or ratings).

## Open Graph images

Static PNGs, rendered once per build, never per request. `src/integrations/seo.ts` runs in
`astro:build:done`, reads `og:title` / `og:description` from every built HTML page and renders a
1200×630 PNG with [satori](https://github.com/vercel/satori) (layout to SVG) and
[`@resvg/resvg-js`](https://github.com/thx/resvg-js) (SVG to PNG) into `dist/client/og/`. Sora and
Public Sans come from `@fontsource/sora` and `@fontsource/public-sans` as WOFF, because satori does
not read WOFF2. The file name follows the
path (`src/seo.ts` `ogImagePath`): `/de/` → `/og/de.png`, `/de/impressum/` → `/og/de/impressum.png`,
`/404` → `/og/404.png`. A new page gets its image without any change here.

Look (direction B, `docs/site/design.md`): the light page colour, the blue-and-yellow mark and
Sora wordmark, the page title in Sora 700, the description in Public Sans, a
`voidbinder.de · Pre-alpha` label, and on the right the four colour fields with the yellow example
card drawn as plain shapes. No artwork.

The integration runs in Node at build time, so the Worker bundle carries neither satori nor resvg.

## Sitemap and robots

- `@astrojs/sitemap` writes `sitemap-index.xml` + `sitemap-0.xml` with `xhtml:link` alternates
  (`de-DE`, `en-GB`). 404 pages are filtered out. `/` is an on-demand redirect and not listed.
- `robots.txt` is an endpoint (`src/pages/robots.txt.ts`, prerendered) so its `Sitemap:` line comes
  from `site`.

## 404 pages

`src/pages/404.astro` (German, with a link to the English start page), `src/pages/de/404.astro`
and `src/pages/en/404.astro`, all rendering `components/NotFound.astro`. Astro serves `/<locale>/404`
for a missing page under `/<locale>/` only when that route exists literally; a
`[locale]/404.astro` is not matched, hence the two locale folders. Checked in `wrangler dev`:
`/de/nope` → German 404, `/en/nope` → English 404, `/nope` → root 404, all with status 404.

## Analytics

Cloudflare Web Analytics, manual beacon, only when `PUBLIC_CF_ANALYTICS_TOKEN` is set at build time
(`docs/environments.md`); without it the page renders no script. `Base.astro` adds

```html
<script
  defer
  src="https://static.cloudflareinsights.com/beacon.min.js"
  data-cf-beacon='{"token":"…"}'
></script>
```

The beacon uses no cookies or `localStorage` and does not fingerprint
([Cloudflare docs](https://developers.cloudflare.com/web-analytics/data-metrics/core-web-vitals/#information-collected)).
It is an external script, so it needs no nonce or hash, only `https://static.cloudflareinsights.com`
in `script-src` and `https://cloudflareinsights.com` in `connect-src` (where the manual setup
reports to). Keep the dashboard's automatic injection off for voidbinder.de so visits are not
counted twice.

## Security headers

One list in `src/security-headers.ts`, two delivery paths:

- **Static assets** (prerendered pages, CSS, fonts, OG images, sitemap, robots.txt): the build
  appends a `/*` rule to `dist/client/_headers`.
- **Worker responses** (`/` redirect, `/api/*`, error pages, one-click unsubscribe): `src/worker.ts`
  sets the same headers, because Cloudflare does not apply `_headers` to Worker responses.

`Strict-Transport-Security` is sent in prod only: the build adds it when `CLOUDFLARE_ENV=prod`, the
Worker when `SITE_URL` equals `site`.

### CSP and Astro

Astro's own CSP (`security.csp`, stable since Astro 6) hashes inline scripts and styles, but on
`@astrojs/cloudflare` 14 it can only emit a `<meta>` tag for prerendered pages: the adapter does not
implement Astro's `staticHeaders` feature. A meta CSP cannot carry `frame-ancestors`, and a second
policy in the header would block every hash it allowed. The site therefore ships no inline code at
all and uses one header policy without hashes or nonces:

- `build.inlineStylesheets: 'never'` keeps Astro from inlining small stylesheets, and
  `vite.build.assetsInlineLimit: 0` keeps it from inlining small processed `<script>` chunks (they
  are emitted as `/_astro/*.js` with a `src` attribute instead);
- components use classes, never `style=""` or `define:vars`;
- `<script>` only with `src` (the beacon) or as a JSON-LD data block, which CSP does not govern;
- `apps/site/test/build.test.ts` fails on an inline `<script>`, a `<style>` element or a `style`
  attribute in the built HTML.

If inline code is ever needed, enable `security.csp` and move the policy to the meta tag plus a
header that keeps only `frame-ancestors`.

### Headers recorded in `wrangler dev` (2026-10-09)

Default build (`pnpm build`, then `pnpm exec wrangler dev` in `apps/site`), `curl -sD - -o /dev/null`:

```text
GET /de/                200   (static asset, from _headers)
GET /                   302   (Worker)
GET /de/nope, /en/nope,
    /nope               404   (Worker, prerendered 404 page)
GET /og/de.png, /robots.txt,
    /sitemap-index.xml  200   (static assets)
POST /api/waitlist      303   (Worker)

Content-Security-Policy: default-src 'self'; script-src 'self' https://static.cloudflareinsights.com; style-src 'self'; img-src 'self' data:; connect-src 'self' https://cloudflareinsights.com; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
X-Content-Type-Options: nosniff
Cross-Origin-Opener-Policy: same-origin
```

Every one of these responses carried all five headers and none set a cookie. With
`CLOUDFLARE_ENV=prod astro build` the same requests also carry
`Strict-Transport-Security: max-age=63072000` (no `includeSubDomains` / `preload` until every
voidbinder.de subdomain is known to serve HTTPS).

## Tests

`apps/site/test/build.test.ts` (after `astro build`): every built HTML page has exactly one title, a
description, one canonical on `https://voidbinder.de/`, `hreflang` de / en / x-default and an
`og:image` whose file exists in `dist/client`; `robots.txt` points at `sitemap-index.xml`, which
exists; the three 404 pages exist; no inline scripts or styles; `_headers` carries the CSP and no
page or header sets a cookie.
