import type { DBAdapter } from 'better-auth';
import { describe, expect, it } from 'vitest';
import { secretCipher, withEncryptedTotpSecret } from './two-factor';

describe('withEncryptedTotpSecret', () => {
  const cipher = secretCipher(btoa('test-two-factor-key-of-32-bytes!'));
  const inner = {
    updateMany: async () => 1,
    incrementOne: async () => null,
    transaction: async (callback: (trx: unknown) => Promise<unknown>) => callback(inner),
  } as unknown as DBAdapter;
  const adapter = withEncryptedTotpSecret(() => inner, cipher)({});
  const where = [{ field: 'id', value: '1' }];

  it('refuses to write the TOTP secret where it cannot encrypt it', async () => {
    const update = { model: 'twoFactor', where, update: { secret: 'plain' } };
    const increment = { model: 'twoFactor', where, increment: {}, set: { secret: 'plain' } };
    await expect(adapter.updateMany(update)).rejects.toThrow(/updateMany/);
    await expect(adapter.incrementOne(increment)).rejects.toThrow(/incrementOne/);
    await expect(adapter.transaction((trx) => trx.updateMany(update))).rejects.toThrow(
      /updateMany/,
    );
  });

  it('passes other writes through', async () => {
    const counter = { model: 'twoFactor', where, increment: { failedVerificationCount: 1 } };
    await expect(adapter.incrementOne(counter)).resolves.toBeNull();
    await expect(
      adapter.updateMany({ model: 'user', where, update: { secret: 'not the 2FA one' } }),
    ).resolves.toBe(1);
  });
});
