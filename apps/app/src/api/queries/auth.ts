import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, authClient } from '../client';
import { read } from './http';
import { meKey, signedOut } from './me';

/** Why an auth call failed, as the screens tell the user. */
export type AuthFailure =
  | 'invalid'
  | 'unverified'
  | 'rateLimited'
  | 'tokenInvalid'
  | 'wrongPassword'
  | 'codeInvalid'
  | 'turnstile'
  | 'generic';

export class AuthError extends Error {
  constructor(readonly reason: AuthFailure) {
    super(reason);
  }
}

// Better Auth answers `{ data, error }`; error has the HTTP status (apps/api/README.md, Authentication).
type Result<T> = { data: T; error: null } | { data: null; error: { status: number } };

async function unwrap<T>(
  call: Promise<Result<T>>,
  onStatus: Partial<Record<number, AuthFailure>> = {},
) {
  const { data, error } = await call;
  if (error) {
    throw new AuthError(
      onStatus[error.status] ?? (error.status === 429 ? 'rateLimited' : 'generic'),
    );
  }
  return data;
}

// Sign-up cannot set the training-data opt-in: the API takes it only through PATCH /me, which
// needs a session, and the first session starts after the verification mail. So a ticked box waits
// here, keyed by the address, and the first sign-in with that address applies it.
// ponytail: localStorage exists on the web only; native (Sprint 3) drops the choice until it gets
// persistent storage, and the user can still turn it on in the profile.
const PENDING_OPT_IN = 'voidbinder.pendingOptIn';
const storage = () => (globalThis as { localStorage?: Storage }).localStorage;

export function rememberOptIn(email: string) {
  storage()?.setItem(PENDING_OPT_IN, email.trim().toLowerCase());
}

async function applyPendingOptIn(email: string) {
  if (storage()?.getItem(PENDING_OPT_IN) !== email.trim().toLowerCase()) return;
  try {
    await read(api.me.$patch({ json: { trainingDataOptIn: true } }));
    storage()?.removeItem(PENDING_OPT_IN);
  } catch {
    // Signed in all the same; the next sign-in tries again.
  }
}

/**
 * The password step. `twoFactor: true` means the account has 2FA: no session yet, the code goes
 * to `useVerifyTwoFactor` (the `/two-factor` screen) within 10 minutes.
 */
export function useSignIn() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { email: string; password: string }) => {
      const data = await unwrap(authClient.signIn.email(input), {
        401: 'invalid',
        403: 'unverified',
      });
      if (data && 'twoFactorRedirect' in data && data.twoFactorRedirect) return { twoFactor: true };
      await applyPendingOptIn(input.email);
      return { twoFactor: false };
    },
    onSuccess: () => client.invalidateQueries({ queryKey: meKey }),
  });
}

/**
 * The second step of a sign-in: a TOTP code or a backup code. `trustDevice` skips the step on
 * this device for 30 days. Every wrong code and an expired step answer the same 401.
 */
export function useVerifyTwoFactor() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { code: string; backup: boolean; trustDevice: boolean }) => {
      const body = { code: input.code, trustDevice: input.trustDevice };
      const data = await unwrap(
        input.backup
          ? authClient.twoFactor.verifyBackupCode(body)
          : authClient.twoFactor.verifyTotp(body),
        { 400: 'codeInvalid', 401: 'codeInvalid' },
      );
      if (data) await applyPendingOptIn(data.user.email);
      return data;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: meKey }),
  });
}

const twoFactorKey = [...meKey, 'twoFactor'] as const;

/** Whether the signed-in user has 2FA on, from the session table (not the cookie cache). */
export function useTwoFactorEnabled() {
  return useQuery({
    queryKey: twoFactorKey,
    queryFn: async () => {
      const data = await unwrap(authClient.getSession({ query: { disableCookieCache: true } }));
      return data?.user.twoFactorEnabled === true;
    },
  });
}

/** Step one of the setup: the password gives the otpauth URL and the backup codes; 2FA is still off. */
export function useEnableTwoFactor() {
  return useMutation({
    mutationFn: (password: string) =>
      unwrap(authClient.twoFactor.enable({ password }), { 400: 'wrongPassword' }),
  });
}

/** Step two: the first code from the app turns 2FA on. */
export function useConfirmTwoFactor() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (code: string) =>
      unwrap(authClient.twoFactor.verifyTotp({ code }), { 401: 'codeInvalid' }),
    onSuccess: () => client.setQueryData(twoFactorKey, true),
  });
}

/** New backup codes; the old ones stop working. */
export function useRegenerateBackupCodes() {
  return useMutation({
    mutationFn: (password: string) =>
      unwrap(authClient.twoFactor.generateBackupCodes({ password }), { 400: 'wrongPassword' }),
  });
}

export function useDisableTwoFactor() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (password: string) =>
      unwrap(authClient.twoFactor.disable({ password }), { 400: 'wrongPassword' }),
    onSuccess: () => client.setQueryData(twoFactorKey, false),
  });
}

/**
 * The Turnstile token (VB-72) of the requests the API checks it on: sign-up, the reset request and
 * the verification resend. One token works once, so a failed call needs a fresh one. A 400 on
 * these calls is a failed check (the forms validate everything else first).
 */
// Native builds have no widget yet (Sprint 3) and send none; the API then refuses them.
const turnstile = (token: string | null | undefined) =>
  token ? { headers: { 'cf-turnstile-response': token } } : {};
const CHECK_FAILED = { 400: 'turnstile' } as const;

export function useSignUp() {
  return useMutation({
    mutationFn: ({
      turnstileToken,
      ...input
    }: {
      name: string;
      email: string;
      password: string;
      turnstileToken?: string | null;
    }) => unwrap(authClient.signUp.email(input, turnstile(turnstileToken)), CHECK_FAILED),
  });
}

export function useSignOut() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(authClient.signOut()),
    onSuccess: () => signedOut(client),
  });
}

export function useVerifyEmail() {
  return useMutation({
    mutationFn: (token: string) =>
      unwrap(authClient.verifyEmail({ query: { token } }), {
        400: 'tokenInvalid',
        401: 'tokenInvalid',
      }),
  });
}

export function useResendVerification() {
  return useMutation({
    mutationFn: (input: { email: string; turnstileToken?: string | null }) =>
      unwrap(
        authClient.sendVerificationEmail({ email: input.email }, turnstile(input.turnstileToken)),
        CHECK_FAILED,
      ),
  });
}

export function useRequestPasswordReset() {
  return useMutation({
    mutationFn: (input: { email: string; turnstileToken?: string | null }) =>
      unwrap(
        authClient.requestPasswordReset({ email: input.email }, turnstile(input.turnstileToken)),
        CHECK_FAILED,
      ),
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: (input: { token: string; newPassword: string }) =>
      unwrap(authClient.resetPassword(input), { 400: 'tokenInvalid' }),
  });
}
