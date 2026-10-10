import { describe, expect, it, vi } from 'vitest';
import { R2BlobStore } from './r2-blob-store';

describe('R2BlobStore', () => {
  it('refuses keys outside its prefixes: only images/ and modules/ reach the public bucket', async () => {
    const put = vi.fn(async (key: string) => ({
      key,
      size: 0,
      httpEtag: '"e"',
      uploaded: new Date(),
    }));
    const store = new R2BlobStore({ put } as unknown as R2Bucket, ['images/', 'modules/']);
    const opts = { contentType: 'application/gzip' };
    await expect(
      store.put('raw/prod/scryfall/2026-10-09/all_cards.jsonl.gz', 'x', opts),
    ).rejects.toThrow(/images\/, modules\//);
    await expect(store.put('work/prod/scryfall/r/0.jsonl', 'x', opts)).rejects.toThrow();
    expect(put).not.toHaveBeenCalled();
    await store.put('images/mtg/abc/en/orig.jpg', 'x', { contentType: 'image/jpeg' });
    await store.put('modules/prod/mtg/manifest.json', '{}', { contentType: 'application/json' });
    expect(put).toHaveBeenCalledTimes(2);
  });
});
