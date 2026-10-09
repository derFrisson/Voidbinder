// The parts of YGOPRODeck's objects the importer reads (https://ygoprodeck.com/api-guide/,
// checked 2026-10-10). Fields that are empty or null are absent in the source.

export interface YgoCardSet {
  set_name: string;
  /** `LOB-EN005`: set code, dash, region and number. Some have no dash (`DB49`). */
  set_code: string;
  set_rarity: string;
  /** A price in dollars: not imported (prices are VB-30's). */
  set_price?: string;
}

export interface YgoCardImage {
  id: number;
  image_url: string;
  image_url_small: string;
  image_url_cropped?: string;
}

export interface YgoBanlist {
  ban_tcg?: string;
  ban_ocg?: string;
  ban_goat?: string;
}

/** Present with `misc=yes`. */
export interface YgoMiscInfo {
  /** `TCG`, `OCG`, `Master Duel`, … */
  formats?: string[];
  /** ATK / DEF printed as `?` (the API then reports 0). */
  question_atk?: number;
  question_def?: number;
  [key: string]: unknown;
}

export interface YgoCard {
  id: number;
  name: string;
  type: string;
  frameType: string;
  desc: string;
  race?: string;
  atk?: number;
  def?: number;
  level?: number;
  attribute?: string;
  scale?: number;
  linkval?: number;
  linkmarkers?: string[];
  archetype?: string;
  banlist_info?: YgoBanlist;
  misc_info?: YgoMiscInfo[];
  card_sets?: YgoCardSet[];
  card_images?: YgoCardImage[];
  [key: string]: unknown;
}

/** One entry of `cardsets.php`; a set code can appear more than once (anniversary editions). */
export interface YgoSet {
  set_name: string;
  set_code: string;
  num_of_cards?: number;
  tcg_date?: string;
  set_image?: string;
}
