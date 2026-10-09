// The parts of Scryfall's objects the importer reads (https://scryfall.com/docs/api/cards,
// https://scryfall.com/docs/api/sets, checked 2026-10-09). Everything else is ignored.

export interface ScryfallImageUris {
  normal?: string;
  large?: string;
  png?: string;
}

export interface ScryfallFace {
  name: string;
  printed_name?: string;
  oracle_id?: string;
  mana_cost?: string;
  type_line?: string;
  oracle_text?: string;
  printed_text?: string;
  image_uris?: ScryfallImageUris;
  [key: string]: unknown;
}

export interface ScryfallCard {
  id: string;
  /** Absent on reversible cards, whose faces carry it. */
  oracle_id?: string;
  lang: string;
  name: string;
  printed_name?: string;
  layout: string;
  type_line?: string;
  oracle_text?: string;
  printed_text?: string;
  card_faces?: ScryfallFace[] | undefined;
  legalities: Record<string, string>;
  games: string[];
  finishes: string[];
  set: string;
  collector_number: string;
  rarity?: string;
  artist?: string;
  released_at?: string;
  image_uris?: ScryfallImageUris;
  multiverse_ids?: number[];
  mtgo_id?: number;
  mtgo_foil_id?: number;
  arena_id?: number;
  tcgplayer_id?: number;
  tcgplayer_etched_id?: number;
  cardmarket_id?: number;
  [key: string]: unknown;
}

export interface ScryfallSet {
  id: string;
  code: string;
  name: string;
  set_type: string;
  released_at?: string;
  card_count?: number;
  digital: boolean;
  parent_set_code?: string;
  mtgo_code?: string;
  arena_code?: string;
  tcgplayer_id?: number;
  icon_svg_uri?: string;
}

export interface ScryfallList<T> {
  data: T[];
  has_more: boolean;
}

export interface ScryfallBulkData {
  type: string;
  updated_at: string;
  jsonl_download_uri: string;
  compressed_size: number;
}
