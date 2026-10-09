/**
 * Where the Open Graph image of a page lives, from its URL path or its built file: `/de/` and
 * `de/index.html` → `/og/de.png`, `/de/impressum/` → `/og/de/impressum.png`, `/404` and
 * `404.html` → `/og/404.png`. Seo.astro links it, src/integrations/seo.ts renders it.
 */
export function ogImagePath(pathOrFile: string): string {
  const key = pathOrFile.replace(/(\/?index)?(\.html)?\/?$/, '').replace(/^\//, '') || 'index';
  return `/og/${key}.png`;
}

export const ogImageSize = { width: 1200, height: 630 };
