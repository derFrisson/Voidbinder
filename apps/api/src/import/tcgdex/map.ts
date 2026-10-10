import type { TcgdexCard, TcgdexSet, TcgdexThirdParty } from './types';

// TCGdex objects → catalog rows (apps/api/src/db/schema/catalog.ts). Pure functions: the hash of
// each row decides whether the database row changed, so the output depends on nothing but the
// source object. TCGdex's `pricing`, `updated` and per-variant ids change without the card
// changing: prices belong to VB-30, so none of them reach a row.

export interface SetRow {
  code: string;
  name: string;
  releasedOn: string | null;
  cardCount: number | null;
  kind: string | null;
  externalIds: Record<string, unknown>;
}

export interface CardRow {
  oracleKey: string;
  name: string;
  typeLine: string | null;
  text: string | null;
  attributes: Record<string, unknown>;
  legalities: Record<string, string>;
}

export interface PrintRow {
  number: string;
  rarity: string | null;
  finishes: string[];
  artist: string | null;
  externalIds: Record<string, unknown>;
  releasedOn: string | null;
}

export interface LocalizationRow {
  lang: string;
  name: string;
  text: string | null;
  externalIds: Record<string, unknown>;
}

/** Pokémon TCG Pocket is a mobile game: no physical cards to collect. */
const DIGITAL_SERIES = new Set(['tcgp']);

/** TCGdex variant to catalog finish, in the order the finishes array is stored. */
const FINISHES = [
  ['normal', 'normal'],
  ['reverse', 'reverse'],
  ['holo', 'holo'],
  ['firstEdition', 'first_edition'],
] as const;

const CARD_ATTRIBUTES = [
  'hp',
  'types',
  'stage',
  'evolveFrom',
  'attacks',
  'abilities',
  'weaknesses',
  'resistances',
  'retreat',
  'illustrator',
  'regulationMark',
  // What distinguishes Trainer and Energy cards and the printed card name suffix (V, ex, …).
  'category',
  'trainerType',
  'energyType',
  'suffix',
  'dexId',
] as const;

function pick(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) if (source[key] !== undefined) out[key] = source[key];
  return out;
}

/** True for a TCG Pocket set: the catalog does not list it. */
export const isDigitalSet = (set: TcgdexSet): boolean => DIGITAL_SERIES.has(set.serie?.id ?? '');

export function mapSet(set: TcgdexSet): SetRow {
  return {
    code: set.id,
    name: set.name,
    releasedOn: set.releaseDate ?? null,
    // `official` is 0 for sets without a printed denominator (mep, 30th-c): fall back to `total`.
    cardCount: set.cardCount?.official || set.cardCount?.total || null,
    kind: set.serie?.id ?? null,
    externalIds: {
      tcgdex: set.id,
      ...pick(set as unknown as Record<string, unknown>, [
        'serie',
        'tcgOnline',
        'abbreviation',
        'logo',
        'symbol',
        'legal',
      ]),
      cardCountTotal: set.cardCount?.total,
    },
  };
}

const compact = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Attacks, abilities and rules text as plain lines, the text the search index reads. */
function cardText(card: TcgdexCard): string | null {
  const lines = [
    ...(card.abilities ?? []).map(
      (a) => `${a.type ? `${a.type} ` : ''}${a.name}${a.effect ? `: ${a.effect}` : ''}`,
    ),
    ...(card.attacks ?? []).map(
      (a) =>
        `${a.name}${a.damage === undefined ? '' : ` ${a.damage}`}${a.effect ? `: ${a.effect}` : ''}`,
    ),
    ...(card.effect ? [card.effect] : []),
  ];
  return lines.length ? lines.join('\n') : null;
}

export function mapCard(card: TcgdexCard): CardRow {
  const typeLine = [
    card.category,
    card.types?.join(' / '),
    card.stage ?? card.trainerType ?? card.energyType,
  ]
    .filter(Boolean)
    .join(' - ');
  const legalities: Record<string, string> = {};
  for (const format of ['standard', 'expanded'] as const) {
    const legal = card.legal?.[format];
    if (legal !== undefined) legalities[format] = legal ? 'legal' : 'not_legal';
  }
  return {
    oracleKey: card.id,
    name: card.name,
    typeLine: typeLine || null,
    text: cardText(card),
    attributes: compact(pick(card, CARD_ATTRIBUTES)),
    legalities,
  };
}

/** The ids TCGdex derives from Cardmarket and TCGplayer: a guess, VB-30 does the matching. */
function marketplaceIds(card: TcgdexCard): Record<string, unknown> | undefined {
  const own = card.thirdParty ?? card.variants_detailed?.find((v) => v.thirdParty)?.thirdParty;
  const ids = (t: TcgdexThirdParty | undefined) =>
    t && { cardmarket: t.cardmarket, tcgplayer: t.tcgplayer };
  const variants = Object.fromEntries(
    (card.variants_detailed ?? [])
      .filter((v) => v.thirdParty)
      // `holo_standard` and `holo_jumbo` are different products with different ids.
      .map((v) => [[v.type, v.size].filter(Boolean).join('_'), ids(v.thirdParty)]),
  );
  if (!own) return undefined;
  return {
    mapping_confidence: 'low',
    ...ids(own),
    ...(Object.keys(variants).length && { variants }),
  };
}

/** The image URLs for VB-57, which stores the files; nothing is downloaded here. */
function imageIds(card: TcgdexCard): Record<string, unknown> {
  return card.image
    ? { tcgdex_images: { high: `${card.image}/high.webp`, low: `${card.image}/low.webp` } }
    : {};
}

export function mapPrint(card: TcgdexCard, releasedOn: string | undefined): PrintRow {
  const externalIds = {
    tcgdex: card.id,
    ...imageIds(card),
    tcgdex_marketplace: marketplaceIds(card),
  };
  return {
    number: card.localId,
    rarity: card.rarity ?? null,
    finishes: FINISHES.filter(([key]) => card.variants?.[key]).map(([, finish]) => finish),
    artist: card.illustrator ?? null,
    externalIds: compact(externalIds),
    releasedOn: releasedOn ?? null,
  };
}

/** The print's name, text and image in the language the object was fetched in. */
export function mapLocalization(card: TcgdexCard, lang: string): LocalizationRow {
  return { lang, name: card.name, text: cardText(card), externalIds: imageIds(card) };
}
