import type { CardRow, LocalizationRow, PrintRow, SetRow } from '../scryfall/map';
import type { YgoCard, YgoSet } from './types';

// YGOPRODeck objects → catalog rows (apps/api/src/db/schema/catalog.ts). Pure functions: the hash
// of each row decides whether the database row changed, so the output must depend on nothing
// but the source object.

/** Region at the start of the part after the dash of a set code (`LOB-DE005`) → language. */
const REGION_LANG: Record<string, string> = {
  EN: 'en',
  DE: 'de',
  FR: 'fr',
  IT: 'it',
  PT: 'pt',
  SP: 'es',
};

/** `sets.code`: lowercase, as the catalog API's `/catalog/sets/:game/:code` looks it up. */
export const setKey = (code: string) => code.toLowerCase();

export interface ParsedCode {
  /** Part before the dash (`LOB`); the whole code when it has no dash (`DB49`). */
  setCode: string;
  /** Part after the dash as printed (`EN005`, `ENA26`, `001`); the whole code without a dash. */
  number: string;
  /** Language of a non-English region code (`DE005` → `de`), else null. */
  language: string | null;
  /** The number with its region replaced by `EN` (`DE005` → `EN005`), else null. */
  englishNumber: string | null;
}

export function parseSetCode(code: string): ParsedCode {
  const dash = code.indexOf('-');
  if (dash < 0) return { setCode: code, number: code, language: null, englishNumber: null };
  const number = code.slice(dash + 1);
  const region = number.slice(0, 2);
  const language = REGION_LANG[region];
  const foreign = language && region !== 'EN';
  return {
    setCode: code.slice(0, dash),
    number,
    language: foreign ? language : null,
    englishNumber: foreign ? `EN${number.slice(2)}` : null,
  };
}

/** Card-level fields kept in `cards.attributes` (the source's names, empty ones absent). */
export function mapCard(card: YgoCard): CardRow {
  const misc = card.misc_info?.[0];
  // The API reports `?` as 0 and flags it in misc_info.
  const stat = (value: number | undefined, question: number | undefined) =>
    question ? '?' : value;
  // Xyz monsters have a rank where other monsters have a level.
  const isXyz = card.type.toUpperCase().includes('XYZ');
  const attributes: Record<string, unknown> = {
    atk: stat(card.atk, misc?.question_atk),
    def: stat(card.def, misc?.question_def),
    level: isXyz ? undefined : card.level,
    rank: isXyz ? card.level : undefined,
    linkval: card.linkval,
    scale: card.scale,
    attribute: card.attribute,
    race: card.race,
    archetype: card.archetype,
    frameType: card.frameType,
    linkmarkers: card.linkmarkers,
  };

  // Ban list status per format; a card in a format without an entry is unrestricted there.
  const legalities: Record<string, string> = {};
  for (const [format, name, status] of [
    ['tcg', 'TCG', card.banlist_info?.ban_tcg],
    ['ocg', 'OCG', card.banlist_info?.ban_ocg],
  ] as const) {
    if (status) legalities[format] = status;
    else if (misc?.formats?.includes(name)) legalities[format] = 'Unlimited';
  }
  if (card.banlist_info?.ban_goat) legalities.goat = card.banlist_info.ban_goat;

  return {
    oracleKey: String(card.id),
    name: card.name,
    typeLine: card.type,
    text: card.desc,
    // Only what the source has: its empty fields (null for a Link Monster's DEF) are not kept.
    attributes: Object.fromEntries(Object.entries(attributes).filter(([, v]) => v != null)),
    legalities,
  };
}

export interface MappedPrint {
  setCode: string;
  /** From the card's own `set_name`; names a set the sets list lacks. */
  setName: string;
  print: PrintRow;
}

/**
 * One print per set and number. The source lists a print once per rarity, and language variants
 * (`LOB-DE005`) next to the English code (`LOB-EN005`): those fold into the English print of the
 * same number, and a variant without one (a German-only code) is a print of its own.
 */
export function mapPrints(card: YgoCard): MappedPrint[] {
  const parsed = (card.card_sets ?? []).map((s) => ({ s, p: parseSetCode(s.set_code) }));
  const own = new Set(
    parsed.filter(({ p }) => !p.language).map(({ p }) => `${p.setCode}|${p.number}`),
  );
  const image = card.card_images?.[0];

  const groups = new Map<
    string,
    {
      setCode: string;
      setName: string;
      number: string;
      language: string | null;
      codes: string[];
      variants: string[];
      rarities: string[];
    }
  >();
  const push = (list: string[], value: string) => {
    if (!list.includes(value)) list.push(value);
  };
  for (const { s, p } of parsed) {
    const folds = p.englishNumber !== null && own.has(`${p.setCode}|${p.englishNumber}`);
    const number = folds ? (p.englishNumber as string) : p.number;
    const key = `${p.setCode}|${number}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        setCode: p.setCode,
        setName: s.set_name,
        number,
        language: folds ? null : p.language,
        codes: [],
        variants: [],
        rarities: [],
      };
      groups.set(key, group);
    }
    if (folds) push(group.variants, s.set_code);
    else {
      push(group.codes, s.set_code);
      if (s.set_rarity.trim()) push(group.rarities, s.set_rarity.trim());
    }
  }

  return [...groups.values()].map((g) => {
    const externalIds = {
      ygoprodeck: card.id,
      set_code: g.codes[0],
      image_url: image?.image_url,
      image_url_small: image?.image_url_small,
      rarities: g.rarities,
      variants: g.variants.length ? g.variants : undefined,
      language: g.language ?? undefined,
    };
    return {
      setCode: g.setCode,
      setName: g.setName,
      print: {
        number: g.number,
        rarity: g.rarities[0] ?? null,
        // The source gives the rarity, not a finish: nothing to add beyond the plain print.
        finishes: ['normal'],
        artist: null,
        externalIds: JSON.parse(JSON.stringify(externalIds)) as Record<string, unknown>,
        releasedOn: null,
      },
    };
  });
}

/** The print's name and text in `lang`; images exist in English only and are on the print. */
export function mapLocalization(card: YgoCard, lang: string): LocalizationRow {
  return { lang, name: card.name, text: card.desc, externalIds: {} };
}

/**
 * One row per set code. `cardsets.php` lists some codes twice (an anniversary edition reuses
 * `LOB`): the earliest release is the set, the others are kept as `editions`.
 */
export function mapSets(source: YgoSet[]): SetRow[] {
  const byCode = new Map<string, YgoSet[]>();
  for (const s of source) byCode.set(s.set_code, [...(byCode.get(s.set_code) ?? []), s]);
  return [...byCode.values()].map((editions) => {
    const sorted = [...editions].sort(
      (a, b) =>
        (a.tcg_date ?? '9999').localeCompare(b.tcg_date ?? '9999') ||
        a.set_name.localeCompare(b.set_name),
    );
    const [set, ...others] = sorted as [YgoSet, ...YgoSet[]];
    const externalIds = {
      // The catalog API looks sets up by lowercase code; the code as printed stays here.
      set_code: set.set_code,
      set_image: set.set_image,
      editions: others.length
        ? others.map((o) => ({ name: o.set_name, date: o.tcg_date, cards: o.num_of_cards }))
        : undefined,
    };
    return {
      code: setKey(set.set_code),
      name: set.set_name,
      releasedOn: set.tcg_date ?? null,
      cardCount: set.num_of_cards ?? null,
      kind: null,
      externalIds: JSON.parse(JSON.stringify(externalIds)) as Record<string, unknown>,
    };
  });
}
