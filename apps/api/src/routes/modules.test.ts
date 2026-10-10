import type { BlobStore, CardStore } from '@voidbinder/core';
import { ModulesResponseSchema, type ModuleManifest } from '@voidbinder/shared/api';
import { describe, expect, it } from 'vitest';
import { createApp, type Platform } from '../app';
import { testDeps } from '../test-helpers';

const manifest: ModuleManifest = {
  game: 'yugioh',
  version: 42,
  schemaVersion: 1,
  minAppSchemaVersion: 1,
  builtAt: '2026-10-10T06:30:00.000Z',
  module: {
    url: 'https://img.voidbinder.de/modules/dev/yugioh/catalog-yugioh-v42.sqlite.gz',
    size: 100,
    sha256: 'a'.repeat(64),
    rawSize: 300,
    rawSha256: 'b'.repeat(64),
  },
  deltas: [
    {
      from: 40,
      to: 42,
      url: 'https://img.voidbinder.de/modules/dev/yugioh/catalog-yugioh-v40-v42.sql.gz',
      size: 10,
      sha256: 'c'.repeat(64),
    },
  ],
};

function app(objects: Record<string, string>) {
  const read: string[] = [];
  const blobStore = {
    get: async (key: string) => {
      read.push(key);
      const text = objects[key];
      return text === undefined ? null : { body: new Blob([text]).stream() };
    },
  } as unknown as BlobStore;
  const platform = {
    cardStore: { catalogVersion: async () => '42' } as unknown as CardStore,
    blobStore,
    close: async () => undefined,
  } as Platform;
  return {
    read,
    app: createApp({ ...testDeps(), importEnv: 'dev', openPlatform: () => platform }),
  };
}

describe('GET /catalog/modules', () => {
  it('answers the manifests of the games that have one, cached like the catalog', async () => {
    const { app: api, read } = app({
      'modules/dev/yugioh/manifest.json': JSON.stringify(manifest),
      'modules/dev/mtg/manifest.json': '{"game":"mtg"}',
    });
    const res = await api.request('/catalog/modules');
    expect(res.status).toBe(200);
    expect(ModulesResponseSchema.parse(await res.json())).toEqual({ modules: [manifest] });
    expect(read.sort()).toEqual([
      'modules/dev/mtg/manifest.json',
      'modules/dev/onepiece/manifest.json',
      'modules/dev/pokemon/manifest.json',
      'modules/dev/yugioh/manifest.json',
    ]);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=60, s-maxage=600');
    const etag = res.headers.get('ETag');
    expect(etag).toMatch(/^"v42-[0-9a-f]{32}"$/);
    const again = await api.request('/catalog/modules', {
      headers: { 'If-None-Match': etag ?? '' },
    });
    expect(again.status).toBe(304);
  });

  it('answers an empty list before the first build', async () => {
    const res = await app({}).app.request('/catalog/modules');
    expect(await res.json()).toEqual({ modules: [] });
  });
});
