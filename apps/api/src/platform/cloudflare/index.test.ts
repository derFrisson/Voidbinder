import { describe, expect, it, vi } from 'vitest';
import { MAIL_FROM } from '../../auth/mail';
import type { CardStore } from '@voidbinder/core';
import { appDeps, startTcgcsvCron, startTcgdexCron } from './index';

const env = (vars: Record<string, unknown>) =>
  ({ APP_URL: 'https://app.example.test', ...vars }) as unknown as Env;

describe('appDeps', () => {
  it('sends the auth mails through the EMAIL binding', async () => {
    const send = vi.fn(async () => ({ messageId: 'm1' }));
    const deps = appDeps(env({ EMAIL: { send } }));
    const message = { to: 'a@example.test', subject: 'S', text: 'T', html: '<p>T</p>' };
    await deps.auth.mail.send(message);
    expect(send).toHaveBeenCalledWith({ from: MAIL_FROM, ...message });
  });

  it('splits CORS_EXTRA_ORIGINS on commas, trims and drops empty entries', () => {
    expect(appDeps(env({ CORS_EXTRA_ORIGINS: 'a, b' })).extraOrigins).toEqual(['a', 'b']);
    expect(appDeps(env({ CORS_EXTRA_ORIGINS: ' a ,, b, ' })).extraOrigins).toEqual(['a', 'b']);
    expect(appDeps(env({})).extraOrigins).toEqual([]);
  });
});

describe('startTcgdexCron', () => {
  const setup = (running: boolean) => {
    const create = vi.fn(async () => ({ id: 'i1' }));
    const close = vi.fn(async () => {});
    const asked: string[] = [];
    const platform = {
      cardStore: {
        importRunning: async (source: string) => (asked.push(source), running),
      } as Partial<CardStore> as CardStore,
      close,
    };
    return { env: env({ TCGDEX_IMPORT: { create } }), platform, create, close, asked };
  };

  it("starts the day's instance when no TCGdex run is going", async () => {
    const { env: e, platform, create, close, asked } = setup(false);
    await startTcgdexCron(e, 'tcgdex-2026-10-10', platform);
    expect(asked).toEqual(['tcgdex']);
    expect(create).toHaveBeenCalledWith({ id: 'tcgdex-2026-10-10', params: {} });
    expect(close).toHaveBeenCalled();
  });

  it('skips the start and logs it while a TCGdex run is going', async () => {
    const { env: e, platform, create, close } = setup(true);
    const info = vi.spyOn(console, 'log').mockImplementation(() => {});
    await startTcgdexCron(e, 'tcgdex-2026-10-10', platform);
    expect(create).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(expect.stringContaining('cron start skipped'));
    info.mockRestore();
  });
});

describe('startTcgcsvCron', () => {
  const setup = (running: boolean) => {
    const create = vi.fn(async () => ({ id: 'i1' }));
    const close = vi.fn(async () => {});
    const asked: string[] = [];
    const platform = {
      cardStore: {
        importRunning: async (source: string) => (asked.push(source), running),
      } as Partial<CardStore> as CardStore,
      close,
    };
    return { env: env({ TCGCSV_IMPORT: { create } }), platform, create, close, asked };
  };

  it("starts the cron's instance when no TCGCSV run is going", async () => {
    const { env: e, platform, create, close, asked } = setup(false);
    await startTcgcsvCron(e, 'tcgcsv-2026-10-10-late', platform);
    expect(asked).toEqual(['tcgcsv']);
    expect(create).toHaveBeenCalledWith({ id: 'tcgcsv-2026-10-10-late' });
    expect(close).toHaveBeenCalled();
  });

  it('skips the start and logs it while a TCGCSV run is going', async () => {
    const { env: e, platform, create, close } = setup(true);
    const info = vi.spyOn(console, 'log').mockImplementation(() => {});
    await startTcgcsvCron(e, 'tcgcsv-2026-10-10-late', platform);
    expect(create).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(expect.stringContaining('cron start skipped'));
    info.mockRestore();
  });
});
