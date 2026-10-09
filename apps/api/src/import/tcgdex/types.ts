// The parts of TCGdex's objects the importer reads (https://tcgdex.dev/rest, the Card, Set and
// Set brief objects, checked 2026-10-10). Everything else, prices above all, is ignored.

export interface TcgdexThirdParty {
  cardmarket?: number;
  tcgplayer?: number;
}

export interface TcgdexVariants {
  normal?: boolean;
  reverse?: boolean;
  holo?: boolean;
  firstEdition?: boolean;
  wPromo?: boolean;
}

export interface TcgdexAttack {
  name: string;
  cost?: string[];
  effect?: string;
  damage?: number | string;
}

export interface TcgdexAbility {
  type?: string;
  name: string;
  effect?: string;
}

export interface TcgdexMultiplier {
  type: string;
  value?: string;
}

export interface TcgdexCard {
  id: string;
  localId: string;
  name: string;
  /** Base URL; `/high.webp` and `/low.webp` are the images. Absent when TCGdex has none. */
  image?: string;
  category: string;
  rarity?: string;
  illustrator?: string;
  hp?: number;
  types?: string[];
  stage?: string;
  suffix?: string;
  evolveFrom?: string;
  dexId?: number[];
  attacks?: TcgdexAttack[];
  abilities?: TcgdexAbility[];
  weaknesses?: TcgdexMultiplier[];
  resistances?: TcgdexMultiplier[];
  retreat?: number;
  effect?: string;
  trainerType?: string;
  energyType?: string;
  regulationMark?: string;
  legal?: { standard?: boolean; expanded?: boolean };
  variants?: TcgdexVariants;
  variants_detailed?: { type: string; thirdParty?: TcgdexThirdParty }[];
  thirdParty?: TcgdexThirdParty;
  [key: string]: unknown;
}

export interface TcgdexCardBrief {
  id: string;
  localId: string;
  name: string;
  image?: string;
}

export interface TcgdexSet {
  id: string;
  name: string;
  releaseDate?: string;
  serie?: { id: string; name: string };
  cardCount?: { official?: number; total?: number };
  logo?: string;
  symbol?: string;
  tcgOnline?: string;
  abbreviation?: { official?: string };
  legal?: { standard?: boolean; expanded?: boolean };
  cards: TcgdexCardBrief[];
}

export interface TcgdexSetBrief {
  id: string;
  name: string;
}
