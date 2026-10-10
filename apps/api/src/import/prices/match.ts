import { raritySlug } from '../ygoprodeck/map';
import { extended, type TcgGroup, type TcgProduct } from './tcgcsv';

// Which TCGplayer group is which catalog set, and which product is which print. Pure functions,
// generic over the games: Magic matches by the TCGplayer ids Scryfall gives (confidence 100),
// Pokémon and Yu-Gi-Oh! by set + number (70) or, failing that, set + a unique name (40); a
// Yu-Gi-Oh! regional print without a product of its own takes the EN product (60, VB-110). An
// admin override (method 'manual') beats all of them; the writer keeps it. Yu-Gi-Oh! rarities are
// compared through `rarityKey` (VB-113: YGOPRODeck's `Short Print` is TCGplayer's `Common`).

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
  /** TCGdex's official abbreviation (`SVI`, Pokémon only), TCGplayer's group abbreviation. */
  abbreviation?: string | null;
  /** The series name (`Scarlet & Violet`, Pokémon only). */
  series?: string | null;
}

export interface CandidatePrint {
  id: string;
  /** Lowercase code of the print's set (`mrd`); a Yu-Gi-Oh! product only takes prints of the set
   * its number names when that set is a candidate (VB-113). */
  setCode?: string;
  number: string;
  /** '' or the Yu-Gi-Oh! rarity slug. */
  variant: string;
  /** English card name. */
  name: string;
  /** Scryfall's TCGplayer product ids (Magic only). */
  tcgplayer: string | null;
  tcgplayerEtched: string | null;
  /** Yugipedia's alt code of the print's artwork (`AA`, VB-106), when it has one. */
  artwork?: string | null;
}

export interface ProductMatch {
  productId: number;
  printId: string;
  method: MatchMethod;
  confidence: number;
  /** Set when the product is one finish whatever its printing (Scryfall's etched product). */
  finish?: string;
  /** Picked among products that differ only by an artwork suffix (VB-113); logged. */
  artwork?: true;
}

/** Lowercase letters and digits only, `&` read as `and`. */
export const normName = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/g, '');

/**
 * Groups no rule matches, by TCGplayer group id: the catalog set code. Derived from TCGCSV's
 * Pokémon groups against TCGdex's sets (2026-10-10, VB-111) and its Yu-Gi-Oh! groups against
 * YGOPRODeck's (VB-113).
 */
export const GROUP_ALIASES: Readonly<Record<number, string>> = {
  1375: 'ecard1', // Expedition
  1863: 'sm1', // SM Base Set
  1418: 'basep', // WoTC Promo
  1423: 'np', // Nintendo Promos
  1421: 'dpp', // Diamond and Pearl Promos
  1453: 'hgssp', // HGSS Promos
  1407: 'bwp', // Black and White Promos
  1451: 'xyp', // XY Promos
  2545: 'swshp', // SWSH: Sword & Shield Promo Cards
  1455: 'bog', // Best of Promos
  1433: 'ru1', // Rumble
  1465: 'bw11', // Legendary Treasures: Radiant Collection (RC1…, in TCGdex's set)
  1729: 'g1', // Generations: Radiant Collection (RC1…, in TCGdex's set)
  24837: '30th-c', // ME: 30th Celebration Classic Collection
  1401: '2011bw', // McDonald's Promos 2011
  1427: '2012bw',
  1692: '2014xy',
  1694: '2015xy',
  3087: '2016xy',
  2148: '2017sm',
  2364: '2018sm',
  2555: '2019sm',
  2782: '2021swsh', // McDonald's 25th Anniversary Promos
  3150: '2022swsh',
  23306: '2023sv',
  24163: '2024sv',
  // Yu-Gi-Oh!: Shonen Jump Magazine Promos, mostly `JUMP-EN…`; its `JMP`/`JMPS` products go to
  // their own sets (`matchProducts`, `setCode`).
  281: 'jump',
};

/**
 * YGOPRODeck's rarity names that TCGplayer writes differently, as `raritySlug`s: each side maps to
 * the same key (checked against TCGCSV's Yu-Gi-Oh! groups, 2026-10-10, VB-113). TCGplayer has no
 * short prints: they are its `Common`.
 */
const RARITY_ALIASES: Readonly<Record<string, string>> = {
  'short-print': 'common',
  'super-short-print': 'common',
  // RA01, RA04 (YGOPRODeck: `Ultimate Rare`, `Collector's Rare`; `Cr` once, in RA04).
  'prismatic-ultimate-rare': 'ultimate-rare',
  'prismatic-collectors-rare': 'collectors-rare',
  cr: 'collectors-rare',
  // King's Court: `Ultra Rare (Pharaoh's Rare)` is TCGplayer's `Ultra Pharaoh’s Rare`.
  'ultra-rare-pharaohs-rare': 'ultra-pharaohs-rare',
  // HAC1: the Duel Terminal parallels are TCGplayer's `Duel Terminal Technology …`.
  'duel-terminal-technology-common': 'duel-terminal-normal-parallel-rare',
  'duel-terminal-technology-ultra-rare': 'duel-terminal-ultra-parallel-rare',
  // One DT07 print (TCGplayer: `Duel Terminal Rare Parallel Rare`).
  'duel-terminal-normal-rare-parallel-rare': 'duel-terminal-rare-parallel-rare',
  starfoil: 'starfoil-rare',
  'extra-secret': 'extra-secret-rare',
};

/** A rarity (a name or a `raritySlug`) as both sources compare: the slug, aliased. */
export const rarityKey = (rarity: string) => {
  const slug = raritySlug(rarity);
  return RARITY_ALIASES[slug] ?? slug;
};

/**
 * The names a group may have in the catalog: its own without TCGplayer's series prefix
 * (`SWSH03: `, `SM - `), then without a trailing `Base Set` (`SV01: Scarlet & Violet Base Set`), then
 * without a leading series name, whole words only (`SV: Scarlet & Violet 151` → `151`, `EX Dragon`
 * → `Dragon`, but not `Expedition` → `pedition`); never `Base Set` alone, which is the first set.
 */
function groupNames(name: string, series: ReadonlySet<string>): string[] {
  const unprefixed = name.replace(/^[A-Z0-9]+(?::| -)\s+/, '');
  const names = [normName(unprefixed), normName(unprefixed.replace(/\s+Base Set$/i, ''))];
  const words = unprefixed.split(/\s+/);
  // Longest series first, so `Sword & Shield` goes before a shorter series it starts with.
  for (let k = words.length - 1; k > 0; k--) {
    const rest = normName(words.slice(k).join(' '));
    if (series.has(normName(words.slice(0, k).join(' '))) && rest && rest !== 'baseset')
      names.push(rest);
  }
  return names;
}

/** `key → value` where the key is unique; a key with two different values maps to null. */
function uniqueMap<K>(pairs: [K, string][]): Map<K, string | null> {
  const out = new Map<K, string | null>();
  for (const [k, v] of pairs) out.set(k, out.has(k) && out.get(k) !== v ? null : v);
  return out;
}

/**
 * The catalog set of each group, or none: Scryfall's group id first, then the abbreviation (TCGdex's
 * official one, where it and the group's are each unique and the group's name holds the set's),
 * the abbreviation as set code (`regional`, Yu-Gi-Oh!: also its code before a dash or slash,
 * `LOB-EN` → `lob`, `MVP1-ENG` → `mvp1`), the name (`groupNames`) and last `GROUP_ALIASES`. A group matches at most one
 * set; several groups may share one set (LOB: `LOB`, the North American prints, and two `LOB-EN`).
 */
export function matchGroups(
  groups: readonly TcgGroup[],
  sets: readonly CatalogSet[],
  { regional = false }: { regional?: boolean } = {},
): { groupId: number; setId: string }[] {
  const byGroupId = new Map(
    sets.flatMap((s) => (s.tcgplayerGroupId ? [[s.tcgplayerGroupId, s.id]] : [])),
  );
  // `PR`, `POP`, `BKP` (Burger King Promos and BREAKpoint): an abbreviation two groups or two
  // sets share says nothing.
  const byAbbreviation = uniqueMap(
    sets.flatMap((s): [string, string][] =>
      s.abbreviation ? [[s.abbreviation.toUpperCase(), s.id]] : [],
    ),
  );
  const groupAbbreviations = uniqueMap(
    groups.flatMap((g): [string, string][] =>
      g.abbreviation ? [[g.abbreviation.toUpperCase(), String(g.groupId)]] : [],
    ),
  );
  const byCode = new Map(sets.map((s) => [s.code.toLowerCase(), s.id]));
  const byName = new Map(sets.map((s) => [normName(s.name), s.id]));
  const series = new Set(sets.flatMap((s) => (s.series ? [normName(s.series)] : [])));
  const setNames = new Map(sets.map((s) => [s.id, normName(s.name)]));
  // TCGplayer's abbreviations are not always TCGdex's (`BST` is EX Battle Stadium there, Battle
  // Styles here; `TR` Team Rocket there, Team Rocket Returns here): the group's name must hold the
  // set's (`SV: Scarlet & Violet 151` holds `151`).
  const abbreviated = (g: TcgGroup) => {
    const key = g.abbreviation?.toUpperCase();
    const setId = key && groupAbbreviations.get(key) ? byAbbreviation.get(key) : undefined;
    return setId && normName(g.name).includes(setNames.get(setId) ?? '\0') ? setId : undefined;
  };
  // Yu-Gi-Oh!: the code before a dash or slash (`LOB-EN`, `MVP1-ENG`, `YS15-ENL`, `RATE-SE`,
  // `DPCT/DPC5`): editions, regions and decks of one set code.
  const byAbbreviationCode = (abbreviation: string) =>
    byCode.get(abbreviation.toLowerCase()) ??
    (regional ? byCode.get(abbreviation.toLowerCase().split(/[-/]/)[0] ?? '') : undefined);
  const alias = (groupId: number) => {
    const code = GROUP_ALIASES[groupId];
    return code === undefined ? undefined : byCode.get(code);
  };
  return groups.flatMap((g) => {
    const setId =
      byGroupId.get(g.groupId) ??
      abbreviated(g) ??
      (g.abbreviation ? byAbbreviationCode(g.abbreviation) : undefined) ??
      groupNames(g.name, series)
        .map((n) => byName.get(n))
        .find(Boolean) ??
      alias(g.groupId);
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

/** TCGplayer's artwork suffix: `(Original Artwork)`, `(New Artwork)`, `(Alternate Art)`. */
const ARTWORK = /\s+\((?:[^()]*\bArtwork|Alternate Art)\)$/i;
const ORIGINAL = /\(Original Artwork\)$/i;
/**
 * Yugipedia's alt codes that mean another artwork (`AA`, `AA2`, `Alt`); the others (`EA`, `B`, `C`,
 * `ReprintB`: further scans of one number; `L`, `S`, `K`: deck letters) are the print's own.
 */
const ALT_ART = /^(?:AA\d*|Alt)$/i;

/** The set code a Yu-Gi-Oh! number starts with (`LCGX-EN001` → `lcgx`), '' without a dash. */
export const codeOf = (number: string) => {
  const dash = number.indexOf('-');
  return dash > 0 ? number.slice(0, dash).toLowerCase() : '';
};

/** Products that look like single cards: TCGCSV's own test is a `Number` or `Rarity`. */
export const isCard = (p: TcgProduct) =>
  extended(p, 'Number') !== null || extended(p, 'Rarity') !== null;

/**
 * The product of a print among products that differ only by TCGplayer's artwork suffix (VB-113,
 * `Harpie Lady (Original Artwork)` and `(New Artwork)`, both MRD-008): a print with Yugipedia's
 * alternate-art code (VB-106, `ALT_ART`) takes the one other artwork (none of several), any other
 * print the original, else the one without a suffix, else the lowest product id. Undefined when
 * the names differ otherwise.
 */
function pickArtwork(products: readonly TcgProduct[], print: CandidatePrint) {
  const bare = products.filter((p) => !ARTWORK.test(p.name));
  const base = new Set(products.map((p) => normName(p.name.replace(ARTWORK, ''))));
  if (products.length < 2 || base.size > 1 || bare.length > 1) return undefined;
  const others = products.filter((p) => ARTWORK.test(p.name) && !ORIGINAL.test(p.name));
  if (print.artwork && ALT_ART.test(print.artwork) && others.length)
    return others.length === 1 ? others[0] : undefined;
  return (
    products.find((p) => ORIGINAL.test(p.name)) ??
    bare[0] ??
    [...products].sort((a, b) => a.productId - b.productId)[0]
  );
}

/**
 * Matches the products of one group to the prints of its set. `byId`: Magic, where Scryfall gives
 * the product ids; otherwise number, then a name unique in the set. A print claimed by more than
 * one product at the same best confidence is ambiguous and left unmatched. `regional` (Yu-Gi-Oh!):
 * products of one number and rarity that differ by name are resolved per print, the one with the
 * print's name wins (`Trial of Hell`, a misprint listed as LOB-012), or artwork variants
 * (`pickArtwork`, 65); rarities through `rarityKey`, so one product prices a number's `Common`, `Short Print` and
 * `Super Short Print`; a product numbered with a candidate set's code takes that set's prints only
 * (LC03's group lists `LCYW-EN…` and `LC03-EN…`); a regional print no product claimed takes the one
 * product of its name and rarity, so one product may price several prints.
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
    return unambiguous(found);
  }

  const codes = new Set(prints.flatMap((p) => (p.setCode ? [p.setCode] : [])));
  /** The candidate set a product's number names, '' for none (or not Yu-Gi-Oh!). */
  const setOf = (product: TcgProduct) => {
    const code = regional ? codeOf(extended(product, 'Number') ?? '') : '';
    return codes.has(code) ? code : '';
  };
  const indexes = new Map<string, ReturnType<typeof index>>();
  const index = (code: string) => {
    const pool = code ? prints.filter((p) => p.setCode === code) : prints;
    return {
      byNumber: groupBy(pool, (p) => normNumber(p.number)),
      byName: groupBy(pool, (p) => normName(p.name)),
    };
  };
  const indexOf = (product: TcgProduct) => {
    const code = setOf(product);
    if (!indexes.has(code)) indexes.set(code, index(code));
    return indexes.get(code) as ReturnType<typeof index>;
  };
  /** The prints of a product's number (and rarity). */
  const numbered = (product: TcgProduct) => {
    const number = extended(product, 'Number');
    const rarity = extended(product, 'Rarity');
    let same = number ? (indexOf(product).byNumber.get(normNumber(number)) ?? []) : [];
    // `LOB-001` and `LOB-EN001` read the same: the print with the product's own number wins.
    const exact = same.filter((p) => number && ownNumber(p.number) === ownNumber(number));
    if (same.length > 1 && exact.length) same = exact;
    // Yu-Gi-Oh! prints one number in several rarities, each a print (`variant`).
    if (same.length > 1 && rarity)
      same = same.filter((p) => rarityKey(p.variant) === rarityKey(rarity));
    // One TCGplayer rarity, several of YGOPRODeck's (`Common`, `Short Print`): one card.
    const one = new Set(same.map((p) => `${p.setCode}|${ownNumber(p.number)}`)).size === 1;
    return same.length === 1 || (regional && rarity && one) ? same : [];
  };
  const byName = (product: TcgProduct) => {
    const named = indexOf(product).byName.get(productName(product.name)) ?? [];
    const [print] = named;
    if (print && named.length === 1)
      found.push({ productId: product.productId, printId: print.id, ...method('name_match') });
  };

  const cards = products.filter(isCard);
  // Yu-Gi-Oh! only: elsewhere two products of one number tie and stay unmapped.
  const family = (p: TcgProduct) => {
    const number = regional && extended(p, 'Number');
    return number
      ? `${setOf(p)}|${number}|${rarityKey(extended(p, 'Rarity') ?? '')}`
      : String(p.productId);
  };
  for (const same of groupBy(cards, family).values()) {
    const [first] = same;
    if (!first) continue;
    const hits = numbered(first);
    if (!hits.length) {
      for (const product of same) byName(product);
      continue;
    }
    for (const print of hits) {
      if (same.length === 1) {
        found.push({ productId: first.productId, printId: print.id, ...method('number_match') });
        continue;
      }
      const named = same.filter((p) => productName(p.name) === normName(print.name));
      const [own] = named;
      if (own && named.length === 1 && named.length < same.length) {
        found.push({ productId: own.productId, printId: print.id, ...method('number_match') });
        continue;
      }
      const pick = pickArtwork(same, print);
      if (pick)
        found.push({
          productId: pick.productId,
          printId: print.id,
          method: 'number_match',
          confidence: CONFIDENCE.number_match - 5,
          artwork: true,
        });
    }
  }
  if (regional) found.push(...regionalMatches(cards, prints, found, setOf));
  return unambiguous(found);
}

/**
 * The regional prints no product claimed, each to the one card product of its name and rarity
 * (several: the EN one of its digits). By name, not digits alone: European numbers differ from the
 * EN ones (`LOB-E053` is Curse of Dragon, `LOB-EN053` Raigeki). A print whose name no product has
 * (TCGplayer's `B. Skull Dragon` is Black Skull Dragon) takes the product of its card's EN print
 * of the same rarity (VB-113).
 */
function regionalMatches(
  products: readonly TcgProduct[],
  prints: readonly CandidatePrint[],
  claimed: readonly ProductMatch[],
  setOf: (product: TcgProduct) => string,
): ProductMatch[] {
  // A unique name (40) is a weaker claim than name and rarity.
  const taken = new Set(claimed.flatMap((m) => (m.method === 'name_match' ? [] : [m.printId])));
  const byNameRarity = groupBy(
    products.filter((p) => extended(p, 'Rarity') !== null),
    (p) => `${productName(p.name)}|${rarityKey(extended(p, 'Rarity') ?? '')}`,
  );
  const card = (p: CandidatePrint) => `${p.setCode}|${normName(p.name)}|${rarityKey(p.variant)}`;
  const printOf = new Map(prints.map((p) => [p.id, p]));
  const siblings = new Map<string, Set<number>>();
  for (const m of claimed) {
    const p = printOf.get(m.printId);
    if (m.method !== 'number_match' || !p || !ownNumber(p.number).startsWith('EN')) continue;
    siblings.set(card(p), (siblings.get(card(p)) ?? new Set()).add(m.productId));
  }
  return prints.flatMap((print) => {
    if (taken.has(print.id) || !isRegional(print.number)) return [];
    let fit = (
      byNameRarity.get(`${normName(print.name)}|${rarityKey(print.variant)}`) ?? []
    ).filter((p) => !setOf(p) || !print.setCode || setOf(p) === print.setCode);
    const number = (p: TcgProduct) => extended(p, 'Number') ?? '';
    if (fit.length > 1) fit = fit.filter((p) => ownNumber(number(p)).startsWith('EN'));
    if (fit.length > 1) fit = fit.filter((p) => digits(number(p)) === digits(print.number));
    const product = fit.length > 1 ? pickArtwork(fit, print) : fit[0];
    if (product)
      return [{ productId: product.productId, printId: print.id, ...method('region_match') }];
    const [sibling, ...more] = siblings.get(card(print)) ?? [];
    return sibling !== undefined && !fit.length && !more.length
      ? [{ productId: sibling, printId: print.id, ...method('region_match') }]
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
