import { HealthResponseSchema } from '@voidbinder/shared/api';
import { env, exports } from 'cloudflare:workers';
import { describe, expect, inject, it } from 'vitest';
import { R2BlobStore } from '../src/platform/cloudflare/r2-blob-store';

declare module 'vitest' {
  interface ProvidedContext {
    databaseUrl: string;
  }
}

describe('Worker', () => {
  it.skipIf(!inject('databaseUrl'))('answers /health through Hyperdrive', async () => {
    const res = await exports.default.fetch('http://api.test/health');
    expect(res.status).toBe(200);
    expect(HealthResponseSchema.parse(await res.json())).toEqual({
      status: 'ok',
      db: 'ok',
      version: 'local',
    });
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
