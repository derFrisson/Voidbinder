// @ts-check
import cloudflare from '@astrojs/cloudflare';
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://voidbinder.de',
  // ponytail: static site, no sessions or image transforms, so no KV / Images bindings.
  session: false,
  adapter: cloudflare({ imageService: 'passthrough' }),
});
