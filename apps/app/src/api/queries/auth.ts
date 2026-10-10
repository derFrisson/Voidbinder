import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, authClient } from '../client';
import { read } from './http';
import { meKey, signedOut } from './me';

/** Why an auth call failed, as the screens tell the user. */
export type AuthFailure = 'invalid' | 'unverified' | 'rateLimited' | 'tokenInvalid' | 'generic';

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

export function useSignIn() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { email: string; password: string }) => {
      const data = await unwrap(authClient.signIn.email(input), {
        401: 'invalid',
        403: 'unverified',
      });
      await applyPendingOptIn(input.email);
      return data;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: meKey }),
  });
}

export function useSignUp() {
  return useMutation({
    mutationFn: (input: { name: string; email: string; password: string }) =>
      unwrap(authClient.signUp.email(input)),
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
    mutationFn: (email: string) => unwrap(authClient.sendVerificationEmail({ email })),
  });
}

export function useRequestPasswordReset() {
  return useMutation({
    mutationFn: (email: string) => unwrap(authClient.requestPasswordReset({ email })),
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: (input: { token: string; newPassword: string }) =>
      unwrap(authClient.resetPassword(input), { 400: 'tokenInvalid' }),
  });
}
