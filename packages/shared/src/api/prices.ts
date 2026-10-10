import { z } from 'zod';
import { CurrencySchema } from './me.js';

// Prices (VB-30): integer cents with a currency on every value, never converted. Every response
// carries the source and the time the source observed the price; condition values are estimates.

/** `tcgplayer` (TCGCSV, USD), `cardmarket` (via Scryfall, EUR), `tcgplayer_scryfall` (USD). */
export const PriceSourceSchema = z.enum(['tcgplayer', 'cardmarket', 'tcgplayer_scryfall']);
export type PriceSource = z.infer<typeof PriceSourceSchema>;

export const ConditionSchema = z.enum(['NM', 'EX', 'GD', 'LP', 'PL', 'PO']);
export type Condition = z.infer<typeof ConditionSchema>;

export const PriceSchema = z.object({
  source: PriceSourceSchema,
  /** Display name of the source, e.g. "Cardmarket (via Scryfall)". */
  sourceLabel: z.string(),
  finish: z.string(),
  currency: CurrencySchema,
  market: z.number().int(),
  low: z.number().int().nullable(),
  mid: z.number().int().nullable(),
  high: z.number().int().nullable(),
  observedAt: z.iso.datetime({ offset: true }),
});
export type Price = z.infer<typeof PriceSchema>;

/**
 * The price shown for a print: one source and finish, in that source's currency, with the time
 * the source observed it (`prices_current.observed_at`).
 */
export const DisplayPriceSchema = z.object({
  source: PriceSourceSchema,
  finish: z.string(),
  currency: CurrencySchema,
  cents: z.number().int(),
  observedAt: z.iso.datetime({ offset: true }),
});
export type DisplayPrice = z.infer<typeof DisplayPriceSchema>;

export const ConditionEstimateSchema = z.object({
  condition: ConditionSchema,
  /** Share of the near-mint price; an estimate, not an observed price. */
  factor: z.number(),
  cents: z.number().int(),
});
export type ConditionEstimate = z.infer<typeof ConditionEstimateSchema>;

/** `GET /catalog/prints/:id/prices?currency=&finish=`. */
export const PricesQuerySchema = z.object({
  /** The user's currency: picks the display price's preferred source (EUR → Cardmarket). */
  currency: CurrencySchema.default('EUR'),
  /** Preferred finish of the display price; the print's `normal` (or first) otherwise. */
  finish: z.string().max(32).optional(),
});
export type PricesQuery = z.infer<typeof PricesQuerySchema>;

export const PrintPricesResponseSchema = z.object({
  printId: z.uuid(),
  /** Every current price, per source and finish. */
  prices: z.array(PriceSchema),
  /** null when the print has no price. */
  display: DisplayPriceSchema.nullable(),
  /** The display price per condition: estimates (`condition_multipliers`), labelled as such. */
  conditions: z.array(ConditionEstimateSchema),
  conditionsAreEstimates: z.literal(true),
});
export type PrintPricesResponse = z.infer<typeof PrintPricesResponseSchema>;

/** `GET /catalog/prints/:id/prices/history?days=`. */
export const PriceHistoryQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(3650).default(90),
});

export const PricePointSchema = z.object({ date: z.iso.date(), cents: z.number().int() });
export type PricePoint = z.infer<typeof PricePointSchema>;

/**
 * Market price points per source and finish, oldest first: one per day for the last 180 days, one
 * per ISO week (its last day) before that.
 */
export const PriceHistoryResponseSchema = z.object({
  printId: z.uuid(),
  days: z.number().int(),
  series: z.array(
    z.object({
      source: PriceSourceSchema,
      finish: z.string(),
      currency: CurrencySchema,
      points: z.array(PricePointSchema),
    }),
  ),
});
export type PriceHistoryResponse = z.infer<typeof PriceHistoryResponseSchema>;

/** `PUT /admin/price-mappings/:printId/:source/:finish`. */
export const PriceMappingRequestSchema = z.object({
  externalId: z.string().trim().min(1).max(64),
  note: z.string().max(500).optional(),
});
export type PriceMappingRequest = z.infer<typeof PriceMappingRequestSchema>;

export const PriceMappingResponseSchema = z.object({
  printId: z.uuid(),
  source: PriceSourceSchema,
  finish: z.string(),
  externalId: z.string(),
  confidence: z.number().int(),
  method: z.literal('manual'),
  overriddenBy: z.string(),
  note: z.string().nullable(),
});
export type PriceMappingResponse = z.infer<typeof PriceMappingResponseSchema>;
