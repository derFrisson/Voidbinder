import type { BlobStore } from '@voidbinder/core';
import { USER_AGENT, type Fetch } from '../scryfall/source';

// Reading from TCGCSV (https://tcgcsv.com/docs and /faq, checked 2026-10-10), which republishes
// TCGplayer's catalog and prices once a day around 20:00 UTC. Its rules: a descriptive
// User-Agent, ~100 ms between requests, at most one pull per day (check `last-updated.txt`
// first) and under 10,000 requests a day. A run asks for the groups of three categories and the
// products and prices of the groups that match a catalog set (Magic: of every group, VB-114):
// about 2,700 requests. Prices are USD, per product and `subTypeName` (the printing), never per
// condition.
//
// The price archive (one 7z per day) is read by the history backfill on the VPS, not here
// (backfill.ts, apps/api/README.md, Prices).

const BASE = 'https://tcgcsv.com';

/** TCGplayer category per game (verified against /tcgplayer/categories, 2026-10-10). */
export const CATEGORIES = { mtg: 1, yugioh: 2, pokemon: 3 } as const;
export type PricedGame = keyof typeof CATEGORIES;

export interface TcgGroup {
  groupId: number;
  name: string;
  abbreviation: string | null;
}

export interface TcgProduct {
  productId: number;
  name: string;
  extendedData?: { name: string; value: string }[];
}

export interface TcgPrice {
  productId: number;
  lowPrice: number | null;
  midPrice: number | null;
  highPrice: number | null;
  marketPrice: number | null;
  subTypeName: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A group without products: TCGCSV publishes no file for it (404). */
export const EMPTY = '{"success":true,"errors":[],"results":[]}';

/**
 * One GET with the User-Agent TCGCSV asks for, after `delayMs` (their 100 ms between requests).
 * null for a 404 when `missingOk`; any other failure throws.
 */
export async function get(
  fetchFn: Fetch,
  path: string,
  delayMs: number,
  missingOk = false,
): Promise<string | null> {
  if (delayMs) await sleep(delayMs);
  const res = await fetchFn(`${BASE}${path}`, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  });
  if (missingOk && res.status === 404) return null;
  if (!res.ok) throw new Error(`GET ${BASE}${path} answered ${res.status}`);
  return res.text();
}

/** The time of TCGCSV's last build (`2026-10-09T20:05:19+0000`) as an ISO timestamp. */
export async function lastUpdated(fetchFn: Fetch, delayMs: number): Promise<string> {
  const text = ((await get(fetchFn, '/last-updated.txt', delayMs)) ?? '').trim();
  const time = Date.parse(text.replace(/([+-]\d\d)(\d\d)$/, '$1:$2'));
  if (Number.isNaN(time)) throw new Error(`last-updated.txt holds no time: ${text.slice(0, 40)}`);
  return new Date(time).toISOString();
}

/** `results` of a TCGCSV answer; an answer with `success: false` fails the step. */
export function results<T>(text: string, what: string): T[] {
  const body = JSON.parse(text) as { success?: boolean; errors?: unknown; results?: T[] };
  if (body.success === false || !Array.isArray(body.results))
    throw new Error(`${what}: ${JSON.stringify(body.errors ?? 'no results').slice(0, 200)}`);
  return body.results;
}

/**
 * Fetches a file and keeps the answer gzip-compressed in the raw bucket (ADR 0003). With
 * `missingOk`, a 404 reads as an empty answer and stores nothing.
 */
export async function fetchRaw(
  fetchFn: Fetch,
  blobs: BlobStore,
  path: string,
  key: string,
  delayMs: number,
  missingOk = false,
): Promise<string> {
  const text = await get(fetchFn, path, delayMs, missingOk);
  if (text === null) return EMPTY;
  const gz = await new Response(
    new Blob([text]).stream().pipeThrough(new CompressionStream('gzip')),
  ).arrayBuffer();
  await blobs.put(key, new Uint8Array(gz), { contentType: 'application/gzip' });
  return text;
}

/** Dollars (a JSON number) to integer cents; null stays null. */
export const cents = (dollars: number | null | undefined): number | null =>
  dollars == null ? null : Math.round(dollars * 100);

/** TCGplayer printings (`subTypeName`) in the catalog's finish names; others become a slug. */
const FINISHES: Record<string, string> = {
  Normal: 'normal',
  Unlimited: 'normal',
  Foil: 'foil',
  Holofoil: 'holo',
  'Unlimited Holofoil': 'holo',
  'Reverse Holofoil': 'reverse',
  '1st Edition': 'first_edition',
  '1st Edition Normal': 'first_edition',
  '1st Edition Holofoil': 'first_edition_holo',
};

export const finishOf = (subTypeName: string): string =>
  FINISHES[subTypeName] ??
  subTypeName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

/** An `extendedData` value (`Number`, `Rarity`), null when the product has none. */
export const extended = (product: TcgProduct, name: string): string | null =>
  product.extendedData?.find((e) => e.name === name)?.value ?? null;
