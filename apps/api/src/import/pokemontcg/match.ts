import { extension } from '../images';
import type { PtcgCard, PtcgSet } from './source';

// Pure matching of our Pokémon sets and prints (TCGdex ids) to pokemontcg.io's (VB-118). A wrong
// match would put another card's picture on a print, so every rule asks for agreement on two
// things (code and name, name and date, number and name) or an explicit alias.

/** Our set as `sets` holds it: the TCGdex id, name, release day and TCGdex's codes. */
export interface OurSet {
  code: string;
  name: string;
  releasedOn: string | null;
  /** `abbreviation.official` (`MCD21`, `SHF:SV`) and `tcgOnline` (`SHF`, `PR-SM`). */
  codes: string[];
}

/**
 * TCGdex id → pokemontcg.io id where neither code, name nor date agree: the McDonald's years
 * (TCGdex names them by series, some dates differ), the EX trainer kits (dates differ), the
 * Unown collection (part of Unseen Forces there) and the SV promos (renamed and redated).
 */
export const SET_ALIASES: Record<string, string> = {
  '2011bw': 'mcd11',
  '2012bw': 'mcd12',
  '2014xy': 'mcd14',
  '2015xy': 'mcd15',
  '2016xy': 'mcd16',
  '2017sm': 'mcd17',
  '2018sm': 'mcd18',
  '2019sm': 'mcd19',
  '2021swsh': 'mcd21',
  '2022swsh': 'mcd22',
  'tk-ex-latia': 'tk1a',
  'tk-ex-latio': 'tk1b',
  'tk-ex-p': 'tk2a',
  'tk-ex-m': 'tk2b',
  exu: 'ex10',
  svp: 'svp',
};

/** Lower case letters and digits only: `Celebrations: Classic Collection`, `Mewtwo-EX`, `Umbreon ★`. */
export const normName = (name: string) =>
  name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/**
 * A collector number for comparison: decoded (`%3F` is TCGdex's `?`), upper case, leading zeros of
 * the digits dropped (`SV001` = `SV1`, `001` = `1`, `TG01` = `TG1`); letters stay (`B`, `24a`).
 */
export function normNumber(number: string): string {
  let n = number;
  try {
    n = decodeURIComponent(number);
  } catch {
    // a lone `%` is the number itself
  }
  return n.toUpperCase().replace(/^([A-Z]*)0+(?=\d)/, '$1');
}

/**
 * Our set code → pokemontcg.io set id, for every set one rule settles: the alias; else a set that
 * shares a code and the name; else the only set with that code when no other of ours carries it
 * (`30C` is both 30th Celebration and the Classic Collection at TCGdex); else the same name and
 * release day.
 */
export function matchSets(ours: OurSet[], theirs: PtcgSet[]): Map<string, string> {
  const byId = new Map(theirs.map((t) => [t.id, t]));
  const ourCodes = new Map<string, number>();
  for (const s of ours)
    for (const c of new Set(s.codes)) ourCodes.set(c, (ourCodes.get(c) ?? 0) + 1);
  const day = (t: PtcgSet) => t.releaseDate.replaceAll('/', '-');
  const one = (list: PtcgSet[]) => (list.length === 1 ? list[0] : undefined);

  const matched = new Map<string, string>();
  for (const s of ours) {
    const alias = SET_ALIASES[s.code];
    if (alias) {
      if (byId.has(alias)) matched.set(s.code, alias);
      continue;
    }
    const name = normName(s.name);
    const byCode = theirs.filter((t) => t.ptcgoCode && s.codes.includes(t.ptcgoCode));
    const found =
      one(byCode.filter((t) => normName(t.name) === name)) ??
      (byCode.length === 1 && ourCodes.get(byCode[0]?.ptcgoCode ?? '') === 1
        ? byCode[0]
        : undefined) ??
      one(theirs.filter((t) => normName(t.name) === name && day(t) === s.releasedOn));
    if (found) matched.set(s.code, found.id);
  }
  return matched;
}

/** One of our prints of the set; only those without a picture are matched. */
export interface OurPrint {
  id: string;
  number: string;
  name: string;
  hasPicture?: boolean;
}

/** What a print stores in `external_ids`: the card id and its two picture URLs. */
export interface PtcgImageIds {
  pokemontcg: string;
  pokemontcg_images: { small?: string | undefined; large: string };
}

/**
 * Print id → the card's ids, for each print one card matches: the same number and name; then,
 * among the rest, a name only one print and one card carry (Celebrations' Classic Collection is
 * CC001… at TCGdex and the original numbers there). Pictured prints only count for the names and
 * keep the cards of their numbers out of the name match, so a `146a` never takes `146`'s card. A
 * card is used once, and only with a `large` picture the mirror can store (a known file extension;
 * `images.scrydex.com` URLs have none).
 */
export function matchCards(prints: OurPrint[], cards: PtcgCard[]): Map<string, PtcgImageIds> {
  const usable = cards.filter((c) => c.images?.large && safeExtension(c.images.large));
  const out = new Map<string, PtcgImageIds>();
  const used = new Set<PtcgCard>();
  const take = (print: OurPrint, card: PtcgCard) => {
    used.add(card);
    out.set(print.id, {
      pokemontcg: card.id,
      pokemontcg_images: { small: card.images?.small, large: card.images?.large as string },
    });
  };

  const todo = prints.filter((p) => !p.hasPicture);
  for (const p of todo) {
    const key = `${normNumber(p.number)} ${normName(p.name)}`;
    const hits = usable.filter((c) => `${normNumber(c.number)} ${normName(c.name)}` === key);
    if (hits.length === 1 && hits[0] && !used.has(hits[0])) take(p, hits[0]);
  }

  const count = <T>(items: T[], name: (t: T) => string) => {
    const n = new Map<string, number>();
    for (const i of items) n.set(name(i), (n.get(name(i)) ?? 0) + 1);
    return n;
  };
  const ourNumbers = new Set(prints.map((p) => normNumber(p.number)));
  const restPrints = todo.filter((p) => !out.has(p.id));
  const restCards = usable.filter((c) => !used.has(c) && !ourNumbers.has(normNumber(c.number)));
  const ourNames = count(
    prints.filter((p) => !out.has(p.id)),
    (p) => normName(p.name),
  );
  const theirNames = count(restCards, (c) => normName(c.name));
  for (const p of restPrints) {
    const name = normName(p.name);
    const card = restCards.find((c) => normName(c.name) === name);
    if (card && ourNames.get(name) === 1 && theirNames.get(name) === 1) take(p, card);
  }
  return out;
}

const safeExtension = (url: string) => {
  try {
    return url.startsWith('https://') && extension(url) !== null;
  } catch {
    return false;
  }
};
