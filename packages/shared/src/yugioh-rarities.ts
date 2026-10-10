// Yu-Gi-Oh! rarities (VB-106, VB-117): Yugipedia's names and file name abbreviations, and the foil
// tiers that decide which print's scan may stand in for another's.

/** Module:Data/static/rarity/data (2026-10-10): abbreviation (in file names) and name. */
export const YUGIOH_RARITIES: readonly (readonly [string, string])[] = [
  ['C', 'Common'],
  ['NR', 'Normal Rare'],
  ['SP', 'Short Print'],
  ['SSP', 'Super Short Print'],
  ['R', 'Rare'],
  ['SR', 'Super Rare'],
  ['UR', 'Ultra Rare'],
  ['UtR', 'Ultimate Rare'],
  ['GR', 'Ghost Rare'],
  ['HGR', 'Holographic Rare'],
  ['ScR', 'Secret Rare'],
  ['PScR', 'Prismatic Secret Rare'],
  ['UScR', 'Ultra Secret Rare'],
  ['ScUR', 'Secret Ultra Rare'],
  ['EScR', 'Extra Secret Rare'],
  ['20ScR', '20th Secret Rare'],
  ['10000ScR', '10000 Secret Rare'],
  ['QCScR', 'Quarter Century Secret Rare'],
  ['StR', 'Starlight Rare'],
  ['GMR', 'Grand Master Rare'],
  ['GUR', 'Gold Rare'],
  ['GScR', 'Gold Secret Rare'],
  ['GGR', 'Ghost/Gold Rare'],
  ['PGR', 'Premium Gold Rare'],
  ['PlR', 'Platinum Rare'],
  ['PlScR', 'Platinum Secret Rare'],
  ['MLR', 'Millennium Rare'],
  ['MLSR', 'Millennium Super Rare'],
  ['MLUR', 'Millennium Ultra Rare'],
  ['MLScR', 'Millennium Secret Rare'],
  ['MLGR', 'Millennium Gold Rare'],
  ['NPR', 'Normal Parallel Rare'],
  ['RPR', 'Rare Parallel Rare'],
  ['SPR', 'Super Parallel Rare'],
  ['UPR', 'Ultra Parallel Rare'],
  ['ScPR', 'Secret Parallel Rare'],
  ['EScPR', 'Extra Secret Parallel Rare'],
  ['HGPR', 'Holographic Parallel Rare'],
  ['DNPR', 'Duel Terminal Normal Parallel Rare'],
  ['DNRPR', 'Duel Terminal Normal Rare Parallel Rare'],
  ['DRPR', 'Duel Terminal Rare Parallel Rare'],
  ['DSPR', 'Duel Terminal Super Parallel Rare'],
  ['DUPR', 'Duel Terminal Ultra Parallel Rare'],
  ['DScPR', 'Duel Terminal Secret Parallel Rare'],
  ['KCC', 'Kaiba Corporation Common'],
  ['KCR', 'Kaiba Corporation Rare'],
  ['KCSR', 'Kaiba Corporation Super Rare'],
  ['KCUR', 'Kaiba Corporation Ultra Rare'],
  ['URBlue', 'Ultra Rare (Special Blue Version)'],
  ['URPurple', 'Ultra Rare (Special Purple Version)'],
  ['URRed', 'Ultra Rare (Special Red Version)'],
  ['ScRBlue', 'Secret Rare (Special Blue Version)'],
  ['ScRRed', 'Secret Rare (Special Red Version)'],
  ['QCScRSV', 'Quarter Century Secret Rare (Special Version)'],
  ['HFR', 'Holofoil Rare'],
  ['SFR', 'Starfoil Rare'],
  ['MSR', 'Mosaic Rare'],
  ['SHR', 'Shatterfoil Rare'],
  ['CR', "Collector's Rare"],
  ['URPR', "Ultra Rare (Pharaoh's Rare)"],
];

/** The module's normalization: `Starlight Rare`, `StR` and `starlight` are one rarity. */
const rarityKey = (v: string) =>
  v
    .trim()
    .toLowerCase()
    .replace(/[/\-_'()]/g, '')
    .replace(/ rare$/, '')
    .replace(/s$/, '')
    .replace(/\s/g, '');

const ABBR = new Map<string, string>([
  ...YUGIOH_RARITIES.flatMap(([abbr, name]): [string, string][] => [
    [rarityKey(abbr), abbr],
    [rarityKey(name), abbr],
  ]),
  // The module's other spellings.
  ['n', 'C'],
  ['altr', 'StR'],
  ['alternate', 'StR'],
  ['mr', 'MLR'],
  ['prismatic', 'PScR'],
  ['goldultra', 'GUR'],
  ['pharaoh', 'URPR'],
]);

/**
 * A rarity name or abbreviation → the abbreviation of Yugipedia's file names; null for a value
 * that is no rarity (YGOPRODeck's placeholders `New`, `2`, `Reprint`, `European debut`).
 */
export const yugiohRarityAbbr = (rarity: string): string | null =>
  ABBR.get(rarityKey(rarity)) ?? null;

/**
 * Foil tiers by abbreviation (Max, 2026-10-10): the plain rarities share tier 0, the special
 * foils rank above them up to Grand Master Rare. A rarity not listed is a tier of its own.
 */
export const YUGIOH_FOIL_TIERS: Readonly<Record<string, number>> = {
  C: 0,
  NR: 0,
  SP: 0,
  SSP: 0,
  R: 0,
  SR: 0,
  UR: 0,
  ScR: 0,
  UtR: 1,
  CR: 2,
  StR: 3,
  QCScR: 4,
  PlScR: 5,
  PScR: 6,
  GUR: 7,
  GR: 8,
  GMR: 9,
};

/**
 * Rarities printed with an artwork of their own, with the gallery alt code of the same artwork in
 * the other rarities: a Grand Master Rare is the Extended Art (MAMO).
 */
export const YUGIOH_RARITY_ARTWORK: Readonly<Record<string, string>> = { GMR: 'EA' };

/**
 * Whether a scan of the same artwork in rarity `sibling` may stand in for a missing scan in
 * `print` (abbreviations): the same rarity, a plainer tier, or both plain. A special foil never
 * backs a plainer print (a Grand Master Rare never backs an Extended Art Ultra Rare); a rarity
 * outside the tiers is backed by the plain ones only and backs no other.
 */
export function yugiohScanBacks(sibling: string, print: string): boolean {
  const [s, p] = [YUGIOH_FOIL_TIERS[sibling], YUGIOH_FOIL_TIERS[print]];
  if (sibling === print) return true;
  if (s === undefined) return false;
  return p === undefined ? s === 0 : s < p || s + p === 0;
}
