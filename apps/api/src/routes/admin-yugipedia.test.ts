import type { CardStore, JobQueue } from '@voidbinder/core';
import { describe, expect, it } from 'vitest';
import { testApp } from '../test-helpers';

// The names and the galleries crawl one site at one request a second (VB-106): one lock.
describe('POST /admin/import/yugipedia[-galleries]', () => {
  const post = async (path: string, running: string | null) => {
    const sent: unknown[] = [];
    const cardStore = {
      importRunning: async (source: string) => source === running,
    } as Partial<CardStore> as CardStore;
    const jobQueue: JobQueue = { send: async (job) => void sent.push(job) };
    const res = await testApp({ adminToken: 't', cardStore, jobQueue }).request(
      `/admin/import/${path}`,
      { method: 'POST', headers: { Authorization: 'Bearer t' } },
    );
    return { status: res.status, sent };
  };

  it('answers 409 while the other Yugipedia import runs', async () => {
    expect(await post('yugipedia-galleries', 'yugipedia')).toEqual({ status: 409, sent: [] });
    expect(await post('yugipedia', 'yugipedia-galleries')).toEqual({ status: 409, sent: [] });
    expect(await post('yugipedia-galleries', 'tcgdex')).toEqual({
      status: 202,
      sent: [{ type: 'yugipedia-galleries-import', payload: { galleries: 'only' } }],
    });
  });
});
