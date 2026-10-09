import type { BlobStore } from '@voidbinder/core';
import { createApp, type Platform } from './app';

/** A blob store for tests that never touch blobs. */
const noBlobs = new Proxy({} as BlobStore, {
  get: () => () => Promise.reject(new Error('blob store not available in this test')),
});

/** The app with an in-memory platform whose database ping succeeds or fails. */
export function testApp(opts: { dbUp?: boolean } = {}) {
  const platform: Platform = {
    cardStore: {
      ping: () => (opts.dbUp === false ? Promise.reject(new Error('down')) : Promise.resolve()),
    },
    blobStore: noBlobs,
    close: async () => undefined,
  };
  return createApp({
    appUrl: 'https://app.example.test',
    version: 'test',
    openPlatform: () => platform,
  });
}
