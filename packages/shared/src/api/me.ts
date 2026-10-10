import { z } from 'zod';
import { LocaleSchema } from '../index.js';

export const CurrencySchema = z.enum(['EUR', 'USD']);
export type Currency = z.infer<typeof CurrencySchema>;

/** A source language code (`en`, `de`, `ja`, `zhs`, …). */
export const LangSchema = z.string().regex(/^[a-z]{2,3}$/);

export const DisplayNameSchema = z.string().trim().min(2).max(40);

/** `GET /me` and `PATCH /me`: the signed-in user and their profile. */
export const MeResponseSchema = z.object({
  id: z.string(),
  email: z.email(),
  emailVerified: z.boolean(),
  /** The name given at sign-up (Better Auth's `name`). */
  name: z.string(),
  /** Shown to others; null until the user sets one. */
  displayName: DisplayNameSchema.nullable(),
  /** Language of the app and of the mails. */
  language: LocaleSchema,
  /** Currency prices are shown in. */
  currency: CurrencySchema,
  /** Whether the user's scans may be used as training data; off unless the user turns it on. */
  trainingDataOptIn: z.boolean(),
  /** Set by `DELETE /me`; the account is purged later (VB-45). */
  deletionRequestedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

/** `PATCH /me`: any subset of the editable profile fields; unknown fields are refused. */
export const UpdateMeRequestSchema = z
  .strictObject({
    displayName: DisplayNameSchema,
    language: LocaleSchema,
    currency: CurrencySchema,
    trainingDataOptIn: z.boolean(),
  })
  .partial();
export type UpdateMeRequest = z.infer<typeof UpdateMeRequestSchema>;

/** `DELETE /me`: 202, the deletion is requested and every session is revoked. */
export const DeleteMeResponseSchema = z.object({ deletionRequestedAt: z.iso.datetime() });
export type DeleteMeResponse = z.infer<typeof DeleteMeResponseSchema>;
