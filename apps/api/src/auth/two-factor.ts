import type { BetterAuthOptions, DBAdapter } from 'better-auth';

/** AES-256-GCM with `TWO_FACTOR_ENCRYPTION_KEY`, for the 2FA secrets at rest. */
export interface SecretCipher {
  encrypt(plain: string): Promise<string>;
  decrypt(stored: string): Promise<string>;
}

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

/**
 * `keyBase64` is 32 bytes in base64 (`openssl rand -base64 32`). A wrong key throws on first use,
 * not here, so a misconfigured key breaks 2FA only, never the rest of sign-in.
 * Stored form: base64 of a 12-byte IV followed by the ciphertext and its tag.
 */
export function secretCipher(keyBase64: string): SecretCipher {
  let key: Promise<CryptoKey> | undefined;
  const getKey = () =>
    (key ??= (async () => {
      const raw = unb64(keyBase64);
      if (raw.length !== 32) throw new Error('TWO_FACTOR_ENCRYPTION_KEY must be 32 bytes (base64)');
      return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
    })());
  return {
    async encrypt(plain) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const data = new TextEncoder().encode(plain);
      const sealed = new Uint8Array(
        await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await getKey(), data),
      );
      const out = new Uint8Array(iv.length + sealed.length);
      out.set(iv);
      out.set(sealed, iv.length);
      return b64(out);
    },
    async decrypt(stored) {
      const raw = unb64(stored);
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: raw.slice(0, 12) },
        await getKey(),
        raw.slice(12),
      );
      return new TextDecoder().decode(plain);
    },
  };
}

type AdapterFactory = (options: BetterAuthOptions) => DBAdapter;
type Row = Record<string, unknown> | null;

/**
 * The database adapter with the TOTP secret of the `twoFactor` table encrypted by `cipher` on top
 * of Better Auth's own encryption (which uses `BETTER_AUTH_SECRET`): the plugin has no option for
 * the secret's key. Backup codes use the plugin's `storeBackupCodes` hook with the same cipher
 * instead, because the plugin compares their stored value in a WHERE clause when it consumes one.
 */
export function withEncryptedTotpSecret(
  factory: AdapterFactory,
  cipher: SecretCipher,
): AdapterFactory {
  return (options) => {
    const inner = factory(options);
    const isTwoFactor = (model: string) => model === 'twoFactor';
    const seal = async <T extends Row>(model: string, data: T): Promise<T> =>
      isTwoFactor(model) && typeof data?.secret === 'string'
        ? { ...data, secret: await cipher.encrypt(data.secret) }
        : data;
    const open = async <T>(model: string, row: T): Promise<T> => {
      const r = row as Row;
      return isTwoFactor(model) && typeof r?.secret === 'string'
        ? ({ ...r, secret: await cipher.decrypt(r.secret) } as T)
        : row;
    };
    const adapter: DBAdapter = {
      ...inner,
      create: async (p) =>
        open(p.model, await inner.create({ ...p, data: await seal(p.model, p.data) })),
      update: async (p) =>
        open(p.model, await inner.update({ ...p, update: await seal(p.model, p.update) })),
      findOne: async (p) => open(p.model, await inner.findOne(p)),
      findMany: async <T>(p: Parameters<DBAdapter['findMany']>[0]) =>
        Promise.all((await inner.findMany<T>(p)).map((row) => open(p.model, row))),
    };
    return adapter;
  };
}
