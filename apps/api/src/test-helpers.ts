import type { BlobStore } from '@voidbinder/core';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { createApp, type AppDeps, type Platform } from './app';
import type { MailMessage } from './auth/mail';

/** A blob store for tests that never touch blobs. */
const noBlobs = new Proxy({} as BlobStore, {
  get: () => () => Promise.reject(new Error('blob store not available in this test')),
});

/** The deps every test app shares; `mails` records what the app sent. */
export function testDeps(mails: MailMessage[] = []): Omit<AppDeps, 'openPlatform'> {
  return {
    appUrl: 'https://app.example.test',
    extraOrigins: [],
    version: 'test',
    auth: {
      secret: 'test-secret-that-is-at-least-32-bytes-long',
      apiUrl: 'https://api.example.test',
      mail: { send: async (m) => void mails.push(m) },
    },
  };
}

/** The app with an in-memory platform whose database ping succeeds or fails. */
export function testApp(opts: { dbUp?: boolean; extraOrigins?: string[] } = {}) {
  const platform: Platform = {
    cardStore: {
      ping: () => (opts.dbUp === false ? Promise.reject(new Error('down')) : Promise.resolve()),
    },
    blobStore: noBlobs,
    db: new Proxy({} as NodePgDatabase, {
      get: () => {
        throw new Error('database not available in this test');
      },
    }),
    close: async () => undefined,
  };
  return createApp({
    ...testDeps(),
    extraOrigins: opts.extraOrigins ?? [],
    openPlatform: () => platform,
  });
}
