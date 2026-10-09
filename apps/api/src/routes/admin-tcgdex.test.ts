import type { CardStore, JobQueue } from '@voidbinder/core';
import { describe, expect, it } from 'vitest';
import { testApp } from '../test-helpers';

describe('POST /admin/import/tcgdex', () => {
  const setup = (running = false) => {
    const sent: unknown[] = [];
    const asked: string[] = [];
    const cardStore = {
      importRunning: async (source: string) => (asked.push(source), running),
    } as Partial<CardStore> as CardStore;
    const jobQueue: JobQueue = { send: async (job) => void sent.push(job) };
    const app = testApp({ adminToken: 't', cardStore, jobQueue });
    const post = (query = '', token = 't') =>
      app.request(`/admin/import/tcgdex${query}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    return { sent, asked, post };
  };

  it('starts an incremental import by default', async () => {
    const { sent, asked, post } = setup();
    const res = await post();
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ status: 'started' });
    expect(asked).toEqual(['tcgdex']);
    expect(sent).toEqual([{ type: 'tcgdex-import', payload: { mode: 'incremental' } }]);
  });

  it('starts a full import on ?mode=full', async () => {
    const { sent, post } = setup();
    expect((await post('?mode=full')).status).toBe(202);
    expect(sent).toEqual([{ type: 'tcgdex-import', payload: { mode: 'full' } }]);
  });

  it('answers 409 while a TCGdex import runs, and 400 for an unknown mode', async () => {
    const running = setup(true);
    const res = await running.post();
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: 'import_running' } });
    expect(running.sent).toEqual([]);

    const bad = setup();
    expect((await bad.post('?mode=everything')).status).toBe(400);
    expect(bad.sent).toEqual([]);
  });

  it('needs the admin token', async () => {
    const { sent, post } = setup();
    expect((await post('', 'wrong')).status).toBe(401);
    expect(sent).toEqual([]);
  });
});
