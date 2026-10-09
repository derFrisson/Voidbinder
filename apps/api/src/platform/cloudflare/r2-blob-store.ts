import type { BlobInfo, BlobList, BlobPutOptions, BlobStore, ByteStream } from '@voidbinder/core';

function info(o: R2Object): BlobInfo {
  const { contentType, cacheControl } = o.httpMetadata ?? {};
  return {
    key: o.key,
    size: o.size,
    // Quoted, ready for an ETag response header.
    etag: o.httpEtag,
    uploaded: o.uploaded,
    ...(contentType && { contentType }),
    ...(cacheControl && { cacheControl }),
  };
}

export class R2BlobStore implements BlobStore {
  /** `onlyPrefix`: `put` refuses every other key (the public `CATALOG` bucket takes `images/`). */
  constructor(
    private readonly bucket: R2Bucket,
    private readonly onlyPrefix?: string,
  ) {}

  async put(key: string, body: ByteStream | Uint8Array | string, options: BlobPutOptions) {
    if (this.onlyPrefix && !key.startsWith(this.onlyPrefix))
      throw new Error(`refusing to write ${key}: this bucket takes ${this.onlyPrefix} keys only`);
    const { contentType, cacheControl } = options;
    const obj = await this.bucket.put(key, body as ReadableStream | Uint8Array | string, {
      httpMetadata: { contentType, ...(cacheControl && { cacheControl }) },
    });
    // R2 returns null only for a failed `onlyIf` precondition, which is never passed here.
    if (!obj) throw new Error(`R2 put returned no object for ${key}`);
    return info(obj);
  }

  async get(key: string) {
    const obj = await this.bucket.get(key);
    return obj && { ...info(obj), body: obj.body };
  }

  async head(key: string) {
    const obj = await this.bucket.head(key);
    return obj && info(obj);
  }

  async delete(key: string) {
    await this.bucket.delete(key);
  }

  async list(prefix: string, cursor?: string): Promise<BlobList> {
    const res = await this.bucket.list({
      prefix,
      include: ['httpMetadata'],
      ...(cursor && { cursor }),
    });
    return { objects: res.objects.map(info), ...(res.truncated && { cursor: res.cursor }) };
  }
}
