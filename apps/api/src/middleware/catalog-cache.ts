import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../app';

/** Catalog and price responses (ADR 0004): one minute in browsers, ten at Cloudflare's edge. */
export const CATALOG_CACHE_CONTROL = 'public, max-age=60, s-maxage=600';

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
 * A matching `If-None-Match` turns the response into a 304.
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
});
