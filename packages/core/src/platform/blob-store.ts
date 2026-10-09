/**
 * A WHATWG `ReadableStream` of bytes, typed structurally so that core needs neither DOM nor
 * Workers types. Both the Workers and the Node.js streams satisfy it.
 */
export interface ByteStream {
  readonly locked: boolean;
  getReader(): unknown;
}

export interface BlobPutOptions {
  contentType: string;
  /** `Cache-Control` stored with the object and sent when it is served. */
  cacheControl?: string;
}

export interface BlobInfo {
  key: string;
  size: number;
  etag: string;
  uploaded: Date;
  contentType?: string;
  cacheControl?: string;
}

export interface StoredBlob extends BlobInfo {
  body: ByteStream;
}

export interface BlobList {
  objects: BlobInfo[];
  /** Pass to the next `list` call; absent on the last page. */
  cursor?: string;
}

/** Object storage for card images, catalog modules and raw source dumps (ADR 0001, 0003). */
export interface BlobStore {
  put(
    key: string,
    body: ByteStream | Uint8Array | string,
    options: BlobPutOptions,
  ): Promise<BlobInfo>;
  /** null when the key does not exist. */
  get(key: string): Promise<StoredBlob | null>;
  head(key: string): Promise<BlobInfo | null>;
  /** Deleting a missing key is not an error. */
  delete(key: string): Promise<void>;
  list(prefix: string, cursor?: string): Promise<BlobList>;
}
