// @ts-check
import cloudflare from '@astrojs/cloudflare';
import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';
import { seo } from './src/integrations/seo';

export default defineConfig({
  // The one place the site URL lives: canonical, hreflang, og:*, JSON-LD, sitemap and robots.txt
  // all read it through Astro.site / `site`.
  site: 'https://voidbinder.de',
  // `/` is not a page: src/pages/index.ts redirects it by Accept-Language on the Worker.
  i18n: {
    locales: ['de', 'en'],
    defaultLocale: 'de',
    routing: { prefixDefaultLocale: true, redirectToDefaultLocale: false },
  },
  // The CSP allows no inline <style> (src/security-headers.ts), so Astro must not inline small
  // stylesheets.
  build: { inlineStylesheets: 'never' },
  // Processed <script> chunks under 4 KiB would otherwise be inlined and blocked by the hash-less CSP.
  vite: { build: { assetsInlineLimit: 0 } },
  // The legal slugs differ per locale (VB-18). A link with the other locale's slug still lands.
  redirects: {
    '/en/datenschutz': '/en/privacy/',
    '/en/impressum': '/en/imprint/',
    '/de/privacy': '/de/datenschutz/',
    '/de/imprint': '/de/impressum/',
  },
  // ponytail: static site, no sessions or image transforms, so no KV / Images bindings.
  session: false,
  adapter: cloudflare({ imageService: 'passthrough' }),
  integrations: [
    sitemap({
      i18n: { defaultLocale: 'de', locales: { de: 'de', en: 'en' } },
      filter: (page) => !/\/(404|waitlist\/[a-z-]+)\/?$/.test(page),
    }),
    seo(),
  ],
});
