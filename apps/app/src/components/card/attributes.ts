import type { Locale } from '@voidbinder/shared';
import type { Card, PrintDetail } from '@voidbinder/shared/api';
import type { Dict } from '../../i18n/de';

export type Chip = { label: string; value: string };

/** A label from a dictionary map, the raw value when the map does not know it. */
export const label = (map: Record<string, string>, value: string) => map[value] ?? value;

/** `2026-08-22` in the user's format (22.08.2026, 08/22/2026). */
export const formatDate = (iso: string, locale: Locale) =>
  new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(iso));

const str = (v: unknown) =>
  typeof v === 'string' || typeof v === 'number' ? String(v) : undefined;

/**
 * The attribute chips of the card page, per game as the source stores them (`cards.attributes`):
 * Magic mana cost, CMC, colours and P/T; Pokémon HP, types and stage; Yu-Gi-Oh! ATK/DEF, level
 * (rank, link) and attribute. Then the print's rarity and release date. Missing values are left out.
 */
export function attributeChips(
  card: Card,
  print: PrintDetail | undefined,
  t: Dict,
  locale: Locale,
): Chip[] {
  const a = card.attributes;
  const l = t.card.attrs;
  const chips: Chip[] = [];
  const add = (label: string, value: string | undefined | null) => {
    if (value) chips.push({ label, value });
  };
  const list = (v: unknown) => (Array.isArray(v) ? (v as string[]) : undefined);
  if (card.game === 'mtg') {
    const colors = list(a.colors);
    add(l.manaCost, str(a.mana_cost));
    add(l.cmc, str(a.cmc));
    if (str(a.power) && str(a.toughness)) add(l.pt, `${a.power}/${a.toughness}`);
    add(
      l.colors,
      colors &&
        (colors.length
          ? colors.map((c) => label(t.card.colors, c)).join(', ')
          : t.card.colors.none),
    );
  } else if (card.game === 'pokemon') {
    add(l.hp, str(a.hp));
    add(l.types, list(a.types)?.join(', '));
    add(l.stage, str(a.stage));
  } else if (card.game === 'yugioh') {
    add(str(a.def) ? l.atkDef : l.atk, [str(a.atk), str(a.def)].filter(Boolean).join('/'));
    if (str(a.linkval)) add(l.link, str(a.linkval));
    else if (str(a.rank)) add(l.rank, str(a.rank));
    else add(l.level, str(a.level));
    add(l.attribute, str(a.attribute));
  }
  add(l.rarity, print?.rarity && label(t.card.rarities, print.rarity));
  add(l.released, print?.releasedOn && formatDate(print.releasedOn, locale));
  return chips;
}
