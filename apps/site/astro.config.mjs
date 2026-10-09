// @ts-check
import cloudflare from '@astrojs/cloudflare';
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://voidbinder.de',
  // `/` is not a page: src/pages/index.ts redirects it by Accept-Language on the Worker.
  i18n: {
    locales: ['de', 'en'],
    defaultLocale: 'de',
    routing: { prefixDefaultLocale: true, redirectToDefaultLocale: false },
  },
  // ponytail: static site, no sessions or image transforms, so no KV / Images bindings.
  session: false,
  adapter: cloudflare({ imageService: 'passthrough' }),
});
