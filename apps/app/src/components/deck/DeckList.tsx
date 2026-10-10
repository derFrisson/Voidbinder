import type {
  DeckAnalysis,
  DeckDetail,
  DeckEntry,
  DeckZone,
  EntryPrint,
} from '@voidbinder/shared/api';
import { Link } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { fmt, useLocale, useT } from '../../i18n';
import { IconButton } from '../collection/Controls';
import { Thumb } from '../collection/Entries';
import { money } from '../collection/format';
import { Icon } from '../Icon';
import { usePalette } from '../palette';
import { useWide } from '../Shell';
import { statText } from './format';

/** The zones as toggle buttons (Haupt / Extra / Side, Commander / Haupt / Side). */
export function ZoneTabs({
  zones,
  zone,
  counts,
  onZone,
}: {
  zones: readonly DeckZone[];
  zone: DeckZone;
  counts: DeckAnalysis['counts'];
  onZone: (zone: DeckZone) => void;
}) {
  const t = useT();
  if (zones.length < 2) return null;
  return (
    <View
      role="group"
      aria-label={t.decks.zonesLabel}
      className="flex-row gap-1 self-start rounded-xl bg-surface-2 p-1"
    >
      {zones.map((z) => {
        const on = z === zone;
        return (
          <Pressable
            key={z}
            role="button"
            aria-pressed={on}
            onPress={() => onZone(z)}
            className={`h-9 flex-row items-center gap-2 rounded-lg px-3.5 ${on ? 'border border-line bg-surface' : ''}`}
          >
            <Text
              className={`font-display text-sm font-semibold ${on ? 'text-ink' : 'text-ink-2'}`}
            >
              {t.decks.tabs[z]}
            </Text>
            <Text className="font-mono text-[12px] text-ink-2">{counts[z] ?? 0}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** "habe 3" (green check) or "fehlt 1" (an outlined tag), from the deck's comparison. */
function Owned({ deck, entry }: { deck: DeckDetail; entry: DeckEntry }) {
  const t = useT();
  const palette = usePalette();
  const missing = deck.analysis.missing.find((m) => m.name === entry.name);
  return missing ? (
    <View className="self-start rounded-md border border-ink px-1.5 py-0.5">
      <Text className="font-display text-[12px] font-semibold text-ink">
        {fmt(t.decks.deckList.missing, { count: missing.needed - missing.owned })}
      </Text>
    </View>
  ) : (
    <View className="flex-row items-center gap-1">
      <Icon name="check" size={14} color={palette.okInk} />
      <Text className="font-display text-[12px] font-semibold text-ok-ink">
        {fmt(t.decks.deckList.have, { count: entry.owned })}
      </Text>
    </View>
  );
}

function Row({
  deck,
  entry,
  onQuantity,
  canAdd,
}: {
  deck: DeckDetail;
  entry: DeckEntry;
  onQuantity: (quantity: number) => void;
  canAdd: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const wide = useWide();
  const l = t.decks.deckList;
  const sub = [
    statText(t, entry.stat),
    entry.typeLine,
    entry.print && `${entry.print.setCode.toUpperCase()}-${entry.print.number}`,
  ].filter(Boolean);
  const thumb = {
    imageUrl: entry.print?.imageUrl ?? null,
    game: deck.game,
  } as EntryPrint;
  const price = entry.price ? (
    <Text className="w-[84px] text-right font-mono text-[13px] font-semibold text-ink">
      {money(entry.price.unitCents * entry.quantity, entry.price.currency, locale)}
    </Text>
  ) : (
    <Text className="w-[84px] text-right font-body text-[12px] text-ink-3">{t.decks.noPrice}</Text>
  );
  const controls = (
    <View className="flex-row">
      <IconButton
        icon="minus"
        label={fmt(l.less, { name: entry.name })}
        onPress={() => onQuantity(entry.quantity - 1)}
      />
      <IconButton
        icon="plus"
        label={fmt(l.more, { name: entry.name })}
        disabled={!canAdd}
        onPress={() => onQuantity(entry.quantity + 1)}
      />
    </View>
  );
  const name = (
    <Link href={`/cards/${entry.cardId}${entry.print ? `?print=${entry.print.id}` : ''}`} asChild>
      <Pressable className="min-w-0 flex-1 flex-row items-center gap-3">
        <Thumb print={thumb} />
        <View className="min-w-0 flex-1">
          <Text
            numberOfLines={2}
            className="font-display text-[15px] font-semibold leading-5 text-ink"
          >
            {entry.name}
          </Text>
          <Text numberOfLines={1} className="font-body text-xs text-ink-2">
            {sub.join(' · ')}
          </Text>
        </View>
      </Pressable>
    </Link>
  );
  return (
    <View role="listitem" className="border-t border-line py-2.5">
      {wide ? (
        <View className="flex-row items-center gap-3">
          <Text className="w-8 font-mono text-[13px] font-semibold text-ink">
            {entry.quantity}×
          </Text>
          {name}
          <Owned deck={deck} entry={entry} />
          {price}
          {controls}
        </View>
      ) : (
        <View className="gap-1.5">
          <View className="flex-row items-center gap-3">
            <Text className="w-8 font-mono text-[13px] font-semibold text-ink">
              {entry.quantity}×
            </Text>
            {name}
          </View>
          <View className="flex-row items-center justify-end gap-3 pl-11">
            <View className="flex-1">
              <Owned deck={deck} entry={entry} />
            </View>
            {price}
            {controls}
          </View>
        </View>
      )}
    </View>
  );
}

/** Groups in the order deck lists print them; an unknown one last. */
const GROUP_ORDER = [
  'monster',
  'spell',
  'trap',
  'pokemon',
  'trainer',
  'energy',
  'creature',
  'planeswalker',
  'battle',
  'instant',
  'sorcery',
  'artifact',
  'enchantment',
  'land',
];
const rank = (group: string) => {
  const i = GROUP_ORDER.indexOf(group);
  return i < 0 ? GROUP_ORDER.length : i;
};

/**
 * The deck list of one zone, grouped by card type (Monster, Zauber, Fallen; Kreaturen, Länder, …)
 * with their counts; each row has "habe n" / "fehlt n", the price of its copies and − / +.
 */
export function DeckList({
  deck,
  zone,
  onQuantity,
}: {
  deck: DeckDetail;
  zone: DeckZone;
  onQuantity: (entry: DeckEntry, quantity: number) => void;
}) {
  const t = useT();
  const entries = deck.entries.filter((e) => e.zone === zone);
  const groups = new Map<string, DeckEntry[]>();
  for (const e of [...entries].sort((a, b) => rank(a.group) - rank(b.group)))
    groups.set(e.group, [...(groups.get(e.group) ?? []), e]);
  const copies = (name: string) =>
    deck.entries.filter((e) => e.name === name).reduce((n, e) => n + e.quantity, 0);
  if (!entries.length)
    return <Text className="py-6 font-body text-[15px] text-ink-2">{t.decks.deckList.empty}</Text>;
  return (
    <View className="gap-5">
      {[...groups].map(([group, rows]) => (
        <View key={group} role="group" aria-label={t.decks.groups[group] ?? group}>
          <View className="flex-row items-center gap-2 pb-2">
            <Text className="font-display text-xs font-semibold uppercase tracking-wider text-ink-2">
              {t.decks.groups[group] ?? group}
            </Text>
            <Text className="rounded-md bg-surface-2 px-1.5 font-mono text-[12px] font-semibold text-ink">
              {rows.reduce((n, e) => n + e.quantity, 0)}
            </Text>
          </View>
          <View role="list">
            {rows.map((e) => (
              <Row
                key={e.cardId}
                deck={deck}
                entry={e}
                // The format's limit per name (basic lands none, a limited card one, …).
                canAdd={e.limit === null || copies(e.name) < e.limit}
                onQuantity={(q) => onQuantity(e, q)}
              />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}
