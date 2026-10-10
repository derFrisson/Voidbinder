import { raritySlug } from '../ygoprodeck/map';
import { extended, type TcgGroup, type TcgProduct } from './tcgcsv';

// Which TCGplayer group is which catalog set, and which product is which print. Pure functions,
// generic over the games: Magic matches by the TCGplayer ids Scryfall gives (confidence 100),
// Pokémon and Yu-Gi-Oh! by set + number (70) or, failing that, set + a unique name (40); a
// Yu-Gi-Oh! regional print without a product of its own takes the EN product (60, VB-110). An
// admin override (method 'manual') beats all of them; the writer keeps it.

export type MatchMethod = 'scryfall_id' | 'number_match' | 'region_match' | 'name_match';

export const CONFIDENCE: Record<MatchMethod, number> = {
  scryfall_id: 100,
  number_match: 70,
  region_match: 60,
  name_match: 40,
};

export interface CatalogSet {
  id: string;
  code: string;
  name: string;
  /** Scryfall's `tcgplayer_id` of the set (Magic only). */
  tcgplayerGroupId: number | null;
}

export interface CandidatePrint {
  id: string;
  number: string;
  /** '' or the Yu-Gi-Oh! rarity slug. */
  variant: string;
  /** English card name. */
  name: string;
  /** Scryfall's TCGplayer product ids (Magic only). */
  tcgplayer: string | null;
  tcgplayerEtched: string | null;
}

export interface ProductMatch {
  productId: number;
  printId: string;
  method: MatchMethod;
  confidence: number;
  /** Set when the product is one finish whatever its printing (Scryfall's etched product). */
  finish?: string;
}

/** Lowercase letters and digits only, `&` read as `and`. */
export const normName = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/g, '');

/** A group's name without the series prefix TCGplayer puts before Pokémon sets (`SWSH03: `). */
const groupName = (name: string) => normName(name.replace(/^[A-Z0-9]+:\s+/, ''));

/**
 * The catalog set of each group, or none: Scryfall's group id first, then the abbreviation as set
 * code, then the name. A group matches at most one set; several groups may share one set.
 */
export function matchGroups(
  groups: readonly TcgGroup[],
  sets: readonly CatalogSet[],
): { groupId: number; setId: string }[] {
  const byGroupId = new Map(
    sets.flatMap((s) => (s.tcgplayerGroupId ? [[s.tcgplayerGroupId, s.id]] : [])),
  );
  const byCode = new Map(sets.map((s) => [s.code.toLowerCase(), s.id]));
  const byName = new Map(sets.map((s) => [normName(s.name), s.id]));
  return groups.flatMap((g) => {
    const setId =
      byGroupId.get(g.groupId) ??
      (g.abbreviation ? byCode.get(g.abbreviation.toLowerCase()) : undefined) ??
      byName.get(groupName(g.name));
    return setId ? [{ groupId: g.groupId, setId }] : [];
  });
}

/**
 * A collector number in a comparable form: the part before `/` (`001/102`), after the last dash
 * (`LOB-EN001`), without a Yu-Gi-Oh! `EN` region (TCGplayer writes `LOB-001` for `LOB-EN001`)
 * and leading zeros.
 */
export const normNumber = (number: string) =>
  (number.split('/')[0]?.split('-').pop() ?? '')
    .toLowerCase()
    .replace(/^en(?=\d)/, '')
    .replace(/^([a-z]*)0+(?=\d)/, '$1');

/** The part of a number after the set code, as printed (`LOB-EN001` → `EN001`). */
const ownNumber = (number: string) => (number.split('/')[0]?.split('-').pop() ?? '').toUpperCase();

/** `normNumber` without a leading region token: `LOB-E001`, `LOB-001` and `LOB-EN001` → `1`. */
const digits = (number: string) => normNumber(number).replace(/^[a-z]{1,2}(?=\d)/, '');

/**
 * Yu-Gi-Oh!'s English printings outside the EN code: none (North America, `LOB-001`), `E`
 * (Europe), `A`/`AE` (Australia/Asia). TCGplayer lists them under the EN product.
 */
const isRegional = (number: string) => /^(?:A|E|AE)?\d/.test(ownNumber(number));

/** A product name without TCGplayer's suffixes (`Pikachu (Secret)`, `Charizard - 4/102`). */
const productName = (name: string) => normName(name.replace(/\s+\(.*\)$|\s+-\s+.*$/, ''));

/** Products that look like single cards: TCGCSV's own test is a `Number` or `Rarity`. */
export const isCard = (p: TcgProduct) =>
  extended(p, 'Number') !== null || extended(p, 'Rarity') !== null;

/**
 * Matches the products of one group to the prints of its set. `byId`: Magic, where Scryfall gives
 * the product ids; otherwise number, then a name unique in the set. A print claimed by more than
 * one product at the same best confidence is ambiguous and left unmatched. `regional`
 * (Yu-Gi-Oh!): a regional print no product claimed takes the one product of its name and rarity,
 * so one product may price several prints.
 */
export function matchProducts(
  products: readonly TcgProduct[],
  prints: readonly CandidatePrint[],
  { byId, regional = false }: { byId: boolean; regional?: boolean },
): ProductMatch[] {
  const found: ProductMatch[] = [];
  if (byId) {
    const ids = new Map<string, { printId: string; finish?: string }>();
    // A product id Scryfall gives more than one print is a tie: none of them gets it.
    const shared = new Set<string>();
    const claim = (id: string, hit: { printId: string; finish?: string }) => {
      const had = ids.get(id);
      if (had && had.printId !== hit.printId) shared.add(id);
      ids.set(id, hit);
    };
    for (const p of prints) {
      if (p.tcgplayer) claim(p.tcgplayer, { printId: p.id });
      if (p.tcgplayerEtched) claim(p.tcgplayerEtched, { printId: p.id, finish: 'etched' });
    }
    for (const product of products) {
      const id = String(product.productId);
      const hit = shared.has(id) ? undefined : ids.get(id);
      if (hit)
        found.push({
          productId: product.productId,
          ...hit,
          method: 'scryfall_id',
          confidence: 100,
        });
    }
  } else {
    const byNumber = groupBy(prints, (p) => normNumber(p.number));
    const byName = groupBy(prints, (p) => normName(p.name));
    for (const product of products) {
      if (!isCard(product)) continue;
      const number = extended(product, 'Number');
      const rarity = extended(product, 'Rarity');
      let same = number ? (byNumber.get(normNumber(number)) ?? []) : [];
      // `LOB-001` and `LOB-EN001` read the same: the print with the product's own number wins.
      const exact = same.filter((p) => number && ownNumber(p.number) === ownNumber(number));
      if (same.length > 1 && exact.length) same = exact;
      // Yu-Gi-Oh! prints one number in several rarities, each a print (`variant`).
      if (same.length > 1 && rarity) same = same.filter((p) => p.variant === raritySlug(rarity));
      const [byNum] = same;
      if (byNum && same.length === 1) {
        found.push({ productId: product.productId, printId: byNum.id, ...method('number_match') });
        continue;
      }
      const named = byName.get(productName(product.name)) ?? [];
      const [byNamed] = named;
      if (byNamed && named.length === 1)
        found.push({ productId: product.productId, printId: byNamed.id, ...method('name_match') });
    }
    if (regional) found.push(...regionalMatches(products, prints, found));
  }
  return unambiguous(found);
}

/**
 * The regional prints no product claimed, each to the one card product of its name and rarity
 * (several: the EN one of its digits). By name, not digits alone: European numbers differ from the
 * EN ones (`LOB-E053` is Curse of Dragon, `LOB-EN053` Raigeki).
 */
function regionalMatches(
  products: readonly TcgProduct[],
  prints: readonly CandidatePrint[],
  claimed: readonly ProductMatch[],
): ProductMatch[] {
  // A unique name (40) is a weaker claim than name and rarity.
  const taken = new Set(claimed.flatMap((m) => (m.method === 'name_match' ? [] : [m.printId])));
  const byNameRarity = groupBy(
    products.filter((p) => extended(p, 'Rarity') !== null),
    (p) => `${productName(p.name)}|${raritySlug(extended(p, 'Rarity') ?? '')}`,
  );
  return prints.flatMap((print) => {
    if (taken.has(print.id) || !isRegional(print.number)) return [];
    let fit = byNameRarity.get(`${normName(print.name)}|${print.variant}`) ?? [];
    const number = (p: TcgProduct) => extended(p, 'Number') ?? '';
    if (fit.length > 1) fit = fit.filter((p) => ownNumber(number(p)).startsWith('EN'));
    if (fit.length > 1) fit = fit.filter((p) => digits(number(p)) === digits(print.number));
    const [product] = fit;
    return product && fit.length === 1
      ? [{ productId: product.productId, printId: print.id, ...method('region_match') }]
      : [];
  });
}

// ponytail: Map.groupBy once the TypeScript lib is ES2024.
function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) out.set(key(item), [...(out.get(key(item)) ?? []), item]);
  return out;
}

const method = (m: MatchMethod) => ({ method: m, confidence: CONFIDENCE[m] });

/** One product per print (and fixed finish): the most confident; a tie leaves the print out. */
function unambiguous(matches: ProductMatch[]): ProductMatch[] {
  const byPrint = groupBy(matches, (m) => `${m.printId}|${m.finish ?? ''}`);
  return [...byPrint.values()].flatMap((claims) => {
    const best = Math.max(...claims.map((c) => c.confidence));
    const top = claims.filter((c) => c.confidence === best);
    return top.length === 1 ? top : [];
  });
}
