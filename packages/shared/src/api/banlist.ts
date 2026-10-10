import { z } from 'zod';
import { CardFormatSchema } from '../index.js';
import { ImageInfoSchema, LangSchema } from './catalog.js';

// Yu-Gi-Oh! ban lists (VB-81): the current Forbidden & Limited List per format, its changes, and
// what of a user's collection and decks they touch. The statuses are the source's (YGOPRODeck's
// `banlist_info`, stored in `cards.legalities.<format>`): `Forbidden`, `Limited`, `Semi-Limited`,
// `Unlimited`; no key: the card is not in that format.

const Timestamp = z.iso.datetime({ offset: true });

/** The lists Voidbinder keeps: the TCG's and the OCG's. */
export const BanlistFormatSchema = z.enum(['tcg', 'ocg']);
export type BanlistFormat = z.infer<typeof BanlistFormatSchema>;

/** Games with a ban list: Yu-Gi-Oh! only (Magic and Pokémon have per-format legalities). */
export const BanlistGameSchema = z.enum(['yugioh']);

/** The restricted statuses, strictest first. */
export const BAN_STATUSES = ['Forbidden', 'Limited', 'Semi-Limited'] as const;
export type BanStatus = (typeof BAN_STATUSES)[number];

/**
 * Copies a status allows: 0, 1, 2, else 3 (Yu-Gi-Oh!'s maximum); null without a status (the card
 * is not in the format). `banned` is the generic word some sources use for Forbidden.
 */
export function banLimit(status: string | null | undefined): number | null {
  if (status == null) return null;
  const s = status.toLowerCase();
  if (s === 'forbidden' || s === 'banned') return 0;
  if (s === 'limited') return 1;
  if (s === 'semi-limited') return 2;
  return 3;
}

/** A restricted status as the source writes it, else null (Unlimited, not in the format). */
export function banStatus(status: string | null | undefined): BanStatus | null {
  return BAN_STATUSES.find((s) => s.toLowerCase() === status?.toLowerCase()) ?? null;
}

/** `GET /catalog/banlist/:game?format=&lang=`. */
export const BanlistQuerySchema = z.object({
  format: BanlistFormatSchema.default('tcg'),
  /** Language of the card names; falls back to English. */
  lang: LangSchema.default('en'),
});
export type BanlistQuery = z.infer<typeof BanlistQuerySchema>;

/** A card as the lists show it, with a representative print (the first one with an image). */
export const BanlistCardSchema = z.object({
  id: z.uuid(),
  /** Name in `?lang=`, falling back to English. */
  name: z.string(),
  printId: z.uuid().nullable(),
  imageUrl: z.url().nullable(),
  ...ImageInfoSchema.shape,
  setCode: z.string().nullable(),
  number: z.string().nullable(),
  /** The number in `?lang=` (VB-97, as on PrintSummary); null without a print. */
  displayNumber: z.string().nullable(),
  /** The game's card format (`CARD_FORMATS`), for the image box. */
  cardFormat: CardFormatSchema,
});
export type BanlistCard = z.infer<typeof BanlistCardSchema>;

/** One status change; null: the card was or is not in the format. */
export const BanlistChangeSchema = z.object({
  from: z.string().nullable(),
  to: z.string().nullable(),
  /** When the import first saw it (not the list's effective date). */
  seenAt: Timestamp,
});
export type BanlistChange = z.infer<typeof BanlistChangeSchema>;

/** Days of changes the list and the impact report. */
export const BANLIST_CHANGE_DAYS = 90;

export const BanlistResponseSchema = z.object({
  format: BanlistFormatSchema,
  /** The list's effective date (Yugipedia), null when unknown. */
  effectiveDate: z.iso.date().nullable(),
  /** End of the last successful YGOPRODeck import: the data's "as of". */
  asOf: Timestamp.nullable(),
  /** Each group sorted by name. */
  groups: z.object({
    forbidden: z.array(BanlistCardSchema),
    limited: z.array(BanlistCardSchema),
    semiLimited: z.array(BanlistCardSchema),
  }),
  /** Changes of a restricted status in the last BANLIST_CHANGE_DAYS days, newest first. */
  changes: z.array(BanlistChangeSchema.extend({ card: BanlistCardSchema })),
});
export type BanlistResponse = z.infer<typeof BanlistResponseSchema>;

/** `GET /me/banlist-impact?game=yugioh&format=&lang=`. */
export const BanlistImpactQuerySchema = BanlistQuerySchema.extend({ game: BanlistGameSchema });
export type BanlistImpactQuery = z.infer<typeof BanlistImpactQuerySchema>;

export const BanlistImpactResponseSchema = z.object({
  format: BanlistFormatSchema,
  /** Cards in the collection whose status changed in the last BANLIST_CHANGE_DAYS days. */
  collection: z.array(
    z.object({
      card: BanlistCardSchema,
      /** Copies in the collection (every print). */
      owned: z.number().int(),
      status: z.string().nullable(),
      change: BanlistChangeSchema,
    }),
  ),
  /** Deck lines whose card changed status lately, or with more copies than the list allows. */
  decks: z.array(
    z.object({
      deck: z.object({ id: z.uuid(), name: z.string() }),
      card: BanlistCardSchema,
      /** Copies in the deck, every zone. */
      copies: z.number().int(),
      /** Copies the list allows (banLimit); null: not in the format. */
      limit: z.number().int().nullable(),
      status: z.string().nullable(),
      change: BanlistChangeSchema.nullable(),
    }),
  ),
});
export type BanlistImpactResponse = z.infer<typeof BanlistImpactResponseSchema>;
