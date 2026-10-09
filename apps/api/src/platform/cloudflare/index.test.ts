import { describe, expect, it, vi } from 'vitest';
import { MAIL_FROM } from '../../auth/mail';
import { appDeps } from './index';

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
