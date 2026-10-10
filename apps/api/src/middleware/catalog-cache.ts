import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../app';

/**
 * Catalog and price responses (ADR 0004): one minute in browsers, which may show it a minute
 * longer while they revalidate, ten minutes in shared caches.
 */
export const CATALOG_CACHE_CONTROL = 'public, max-age=60, s-maxage=600, stale-while-revalidate=60';

/**
 * What Workers Caching (VB-71) reads instead of `Cache-Control`: ten minutes fresh, then ten more
 * served stale while the Worker refreshes in the background. `s-maxage` would switch that off at
 * the edge (RFC 9111 4.2.4), hence the edge's own header; Cloudflare strips it from the response.
 */
export const EDGE_CACHE_CONTROL = 'public, max-age=600, stale-while-revalidate=600';

/**
 * `Cache-Tag` of a cached response, purged by the importers at the end of a run: `modules` for the
 * module manifests, `prices` for the price routes, `catalog` for everything else.
 */
// ponytail: no per-game tags; every catalog import purges all of `catalog`. Add `game:<id>` when
// one game's import should leave the others' cached pages alone.
export function cacheTags(path: string): string {
  if (path.startsWith('/catalog/modules')) return 'modules';
  if (/^\/catalog\/prints\/[^/]+\/prices(\/|$)/.test(path)) return 'prices';
  return 'catalog';
}

function hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Weak comparison (RFC 9110): Cloudflare may weaken the ETag when it compresses the body. */
function matches(ifNoneMatch: string | undefined, etag: string): boolean {
  if (!ifNoneMatch) return false;
  return ifNoneMatch.split(',').some((t) => {
    const tag = t.trim();
    return tag === '*' || tag.replace(/^W\//, '') === etag;
  });
}

/**
 * Makes a 200 cacheable: `Cache-Control` plus an `ETag` of the catalog_version and a hash of the
 * body, so every import changes it and a stale cached read can never get a new version's tag.
 * A matching `If-None-Match` turns the response into a 304. The edge cache (Workers Caching,
 * README "Caching") stores it by URL, tagged for the importers' purge.
 */
export const catalogCache = createMiddleware<AppEnv>(async (c, next) => {
  await next();
  if (c.res.status !== 200) return;
  const [version, body] = await Promise.all([
    c.var.platform.cardStore.catalogVersion(),
    c.res.clone().arrayBuffer(),
  ]);
  const etag = `"v${version}-${hex(await crypto.subtle.digest('SHA-256', body)).slice(0, 32)}"`;
  if (matches(c.req.header('If-None-Match'), etag)) {
    // Hono keeps the earlier headers (CORS, request id) except Content-Type.
    c.res = new Response(null, { status: 304 });
  }
  c.header('ETag', etag);
  c.header('Cache-Control', CATALOG_CACHE_CONTROL);
  c.header('Cloudflare-CDN-Cache-Control', EDGE_CACHE_CONTROL);
  c.header('Cache-Tag', cacheTags(c.req.path));
});
