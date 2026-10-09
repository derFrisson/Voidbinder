import type { ScryfallCard, ScryfallFace, ScryfallImageUris, ScryfallSet } from './types';

// Scryfall objects → catalog rows (apps/api/src/db/schema/catalog.ts). Pure functions: the hash
// of each row decides whether the database row changed, so the output must depend on nothing
// but the source object.

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

/** Not collectible cards: skipped. */
const SKIPPED_LAYOUTS = new Set(['art_series', 'token', 'double_faced_token', 'emblem']);

/** Joins the oracle texts of a multi-face card. */
export const FACE_SEPARATOR = '\n//\n';

/** Card-level gameplay fields kept in `cards.attributes`. */
const CARD_ATTRIBUTES = [
  'layout',
  'mana_cost',
  'cmc',
  'colors',
  'color_identity',
  'color_indicator',
  'power',
  'toughness',
  'loyalty',
  'defense',
  'keywords',
  'produced_mana',
  'reserved',
  'hand_modifier',
  'life_modifier',
] as const;

/**
 * The oracle fields of a face. Faces also carry print fields (artist, flavor text, images), which
 * differ between prints of the same card and would make the card row flip on every print.
 */
const FACE_ATTRIBUTES = [
  'name',
  'oracle_id',
  'layout',
  'mana_cost',
  'cmc',
  'type_line',
  'oracle_text',
  'colors',
  'color_indicator',
  'power',
  'toughness',
  'loyalty',
  'defense',
] as const;

const FINISHES: Record<string, string> = { nonfoil: 'normal' };

function pick(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) if (source[key] !== undefined) out[key] = source[key];
  return out;
}

function images(uris: ScryfallImageUris | undefined): Record<string, string> | undefined {
  if (!uris) return undefined;
  const out = pick(uris as Record<string, unknown>, ['normal', 'large', 'png']);
  return Object.keys(out).length ? (out as Record<string, string>) : undefined;
}

/** The front image URLs plus the scan quality the image mirror (VB-57) waits for. */
function frontImages(card: ScryfallCard): Record<string, unknown> | undefined {
  const uris = images(card.image_uris ?? card.card_faces?.[0]?.image_uris);
  return uris && { ...uris, highres_image: card.highres_image, image_status: card.image_status };
}

function joinFaces(
  faces: ScryfallFace[] | undefined,
  field: keyof ScryfallFace,
  separator: string,
) {
  const parts = (faces ?? [])
    .map((f) => f[field])
    .filter((v): v is string => typeof v === 'string');
  return parts.length ? parts.join(separator) : null;
}

/** Why a card object is not imported, or null when it is. */
export function skipReason(card: ScryfallCard): 'layout' | 'digital' | null {
  if (SKIPPED_LAYOUTS.has(card.layout)) return 'layout';
  // Digital-only (Arena, MTGO) unless the card also exists on paper.
  if (!card.games.includes('paper')) return 'digital';
  return null;
}

/** null for sets without paper cards (digital, tokens), which the catalog does not list. */
export function mapSet(set: ScryfallSet): SetRow | null {
  if (set.digital || set.set_type === 'token') return null;
  return {
    code: set.code,
    name: set.name,
    releasedOn: set.released_at ?? null,
    cardCount: set.card_count ?? null,
    kind: set.set_type,
    externalIds: pick(set as unknown as Record<string, unknown>, [
      'id',
      'tcgplayer_id',
      'mtgo_code',
      'arena_code',
      'parent_set_code',
      'icon_svg_uri',
    ]),
  };
}

/** Legalities that Scryfall decides per print, not per card (Old School counts old prints only). */
const PRINT_LEGALITIES = new Set(['oldschool']);

export function mapCard(print: ScryfallCard): CardRow {
  // A reversible card is one card printed on both sides; its front face carries the oracle data,
  // the same as every other print of that card.
  const card: ScryfallCard =
    !print.oracle_id && print.card_faces?.[0]
      ? { ...print, ...print.card_faces[0], card_faces: undefined }
      : print;
  const faces = card.card_faces;
  const oracleKey = card.oracle_id;
  if (!oracleKey) throw new Error(`Scryfall card ${print.id} has no oracle_id`);
  const attributes = pick(card, CARD_ATTRIBUTES);
  if (faces) attributes.card_faces = faces.map((f) => pick(f, FACE_ATTRIBUTES));
  return {
    oracleKey,
    name: card.name,
    typeLine: card.type_line ?? joinFaces(faces, 'type_line', ' // '),
    text: card.oracle_text ?? joinFaces(faces, 'oracle_text', FACE_SEPARATOR),
    attributes,
    legalities: Object.fromEntries(
      Object.entries(card.legalities).filter(([format]) => !PRINT_LEGALITIES.has(format)),
    ),
  };
}

function imageIds(card: ScryfallCard): Record<string, unknown> {
  const back = card.image_uris ? undefined : images(card.card_faces?.[1]?.image_uris);
  return { scryfall: card.id, scryfall_images: frontImages(card), scryfall_back_images: back };
}

export function mapPrint(card: ScryfallCard): PrintRow {
  const externalIds = {
    ...imageIds(card),
    tcgplayer: card.tcgplayer_id,
    tcgplayer_etched: card.tcgplayer_etched_id,
    cardmarket: card.cardmarket_id,
    mtgo: card.mtgo_id,
    mtgo_foil: card.mtgo_foil_id,
    arena: card.arena_id,
    multiverse: card.multiverse_ids?.length ? card.multiverse_ids : undefined,
  };
  return {
    number: card.collector_number,
    rarity: card.rarity ?? null,
    finishes: card.finishes.map((f) => FINISHES[f] ?? f),
    artist: card.artist ?? null,
    // Drop the undefined ids so the stored JSON (and its hash) has only what the source has.
    externalIds: JSON.parse(JSON.stringify(externalIds)) as Record<string, unknown>,
    releasedOn: card.released_at ?? null,
  };
}

/** The print's name and text in the object's language (`printed_*`, English falls back to oracle). */
export function mapLocalization(card: ScryfallCard): LocalizationRow {
  const faces = card.card_faces;
  const english = card.lang === 'en';
  const text =
    card.printed_text ??
    joinFaces(faces, 'printed_text', FACE_SEPARATOR) ??
    (english ? (card.oracle_text ?? joinFaces(faces, 'oracle_text', FACE_SEPARATOR)) : null);
  return {
    lang: card.lang,
    name: card.printed_name ?? joinFaces(faces, 'printed_name', ' // ') ?? card.name,
    text,
    externalIds: JSON.parse(JSON.stringify(imageIds(card))) as Record<string, unknown>,
  };
}
