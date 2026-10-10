import { HealthResponseSchema } from '@voidbinder/shared/api';
import { env, exports } from 'cloudflare:workers';
import { describe, expect, inject, it, vi } from 'vitest';
import { purgeCache } from '../src/platform/cloudflare/cache';
import { R2BlobStore } from '../src/platform/cloudflare/r2-blob-store';

declare module 'vitest' {
  interface ProvidedContext {
    databaseUrl: string;
  }
}

describe('Worker', () => {
  // The first request loads the whole Worker in workerd, which takes over 5 s on CI runners.
  it.skipIf(!inject('databaseUrl'))(
    'answers /health through Hyperdrive',
    { timeout: 30_000 },
    async () => {
      const res = await exports.default.fetch('http://api.test/health');
      expect(res.status).toBe(200);
      expect(HealthResponseSchema.parse(await res.json())).toEqual({
        status: 'ok',
        db: 'ok',
        version: 'local',
      });
    },
  );

  // Purges are scoped to the calling entrypoint, so the Workflows purge through the default one.
  it('purges the edge cache through the default entrypoint, a no-op where nothing is cached', async () => {
    const warn = vi.spyOn(console, 'warn');
    await purgeCache(['catalog', 'game:mtg']);
    expect(warn).not.toHaveBeenCalled();
    await expect(exports.default.purgeCache(['prices'])).resolves.toBeUndefined();
  });

  it('round-trips a blob through R2', async () => {
    const store = new R2BlobStore(env.CATALOG);
    const put = await store.put('cards/a.json', '{"a":1}', {
      contentType: 'application/json',
      cacheControl: 'public, max-age=60',
    });
    expect(put).toMatchObject({ key: 'cards/a.json', size: 7, contentType: 'application/json' });
    await store.put('cards/b.json', '{}', { contentType: 'application/json' });
    await store.put('other/c.json', '{}', { contentType: 'application/json' });

    const got = await store.get('cards/a.json');
    expect(await new Response(got?.body as ReadableStream).text()).toBe('{"a":1}');
    expect(await store.head('cards/a.json')).toMatchObject({
      etag: put.etag,
      cacheControl: 'public, max-age=60',
    });

    const page = await store.list('cards/');
    expect(page.objects.map((o) => o.key)).toEqual(['cards/a.json', 'cards/b.json']);
    expect(page.objects[0]?.contentType).toBe('application/json');
    expect(page.cursor).toBeUndefined();

    await store.delete('cards/a.json');
    await store.delete('cards/missing.json');
    expect(await store.get('cards/a.json')).toBeNull();
    expect(await store.head('cards/a.json')).toBeNull();
  });
});
