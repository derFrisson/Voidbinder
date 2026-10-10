import type { DeckDetail, DeckZone, EntryPrint, SearchHit } from '@voidbinder/shared/api';
import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { searchable, useSearch } from '../../api/queries/search';
import { fmt, useLocale, useT } from '../../i18n';
import { Thumb } from '../collection/Entries';
import { money } from '../collection/format';
import { Icon } from '../Icon';
import { usePalette } from '../palette';

/**
 * "Karten hinzufügen": the catalog search (VB-35's `GET /catalog/search`) in the deck's game, as
 * you type (250 ms after the last key, from two letters). + adds one copy of the hit's card, with
 * the hit as preferred print, to the zone the list shows.
 */
export function AddCards({
  deck,
  zone,
  onAdd,
  copyLimit,
}: {
  deck: DeckDetail;
  zone: DeckZone;
  onAdd: (hit: SearchHit) => void;
  copyLimit: number;
}) {
  const t = useT();
  const locale = useLocale();
  const palette = usePalette();
  const a = t.decks.add;
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(timer);
  }, [text]);
  const search = useSearch({ q, game: deck.game, lang: locale, page: 1 });
  const inDeck = (cardId: string) =>
    deck.entries.filter((e) => e.cardId === cardId).reduce((n, e) => n + e.quantity, 0);
  const hits = searchable(q) ? (search.data?.prints ?? []) : [];

  return (
    <View role="region" aria-label={a.title} className="gap-3">
      <Text role="heading" aria-level={2} className="font-display text-lg font-bold text-ink">
        {a.title}
      </Text>
      <View className="relative justify-center">
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={a.search}
          aria-label={a.search}
          placeholderTextColor={palette.ink3}
          inputMode="search"
          className="h-11 rounded-xl border border-line bg-surface pl-10 pr-3 font-body text-[15px] text-ink"
        />
        <View className="absolute left-3" pointerEvents="none">
          <Icon name="search" size={16} color={palette.ink3} />
        </View>
      </View>
      <Text className="font-body text-[13px] text-ink-2">
        {fmt(a.hint, { zone: t.decks.zones[zone] })}
      </Text>
      {hits.length > 0 && (
        <View role="list" className={search.isPlaceholderData ? 'opacity-60' : ''}>
          {hits.map((hit) => {
            const n = inDeck(hit.cardId);
            const full = n >= copyLimit;
            const thumb = { imageUrl: hit.imageUrl, game: deck.game } as EntryPrint;
            return (
              <View
                key={hit.id}
                role="listitem"
                className="flex-row items-center gap-3 border-t border-line py-2.5"
              >
                <Thumb print={thumb} />
                <View className="min-w-0 flex-1">
                  <Text
                    numberOfLines={1}
                    className="font-display text-[15px] font-semibold text-ink"
                  >
                    {hit.name}
                  </Text>
                  <Text numberOfLines={1} className="font-body text-xs text-ink-2">
                    <Text className="font-mono">
                      {hit.setCode.toUpperCase()}-{hit.number}
                    </Text>
                    {hit.rarity ? ` · ${hit.rarity}` : ''}
                  </Text>
                  <Text numberOfLines={1} className="font-body text-xs text-ink-2">
                    {[
                      hit.marketPrice &&
                        money(hit.marketPrice.cents, hit.marketPrice.currency, locale),
                      n > 0 && fmt(a.inDeck, { count: n }),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                </View>
                <Pressable
                  role="button"
                  aria-label={
                    full
                      ? `${fmt(a.add, { name: hit.name })}. ${fmt(a.limit, { limit: copyLimit })}`
                      : fmt(a.add, { name: hit.name })
                  }
                  aria-disabled={full}
                  disabled={full}
                  onPress={() => onAdd(hit)}
                  className={`h-10 w-10 items-center justify-center rounded-xl ${full ? 'bg-surface-2 opacity-50' : 'bg-blue-soft'}`}
                >
                  <Icon name="plus" size={18} color={full ? palette.ink3 : palette.blueInk} />
                </Pressable>
              </View>
            );
          })}
        </View>
      )}
      {searchable(q) && search.data && (
        <Text role="status" className="font-body text-[13px] text-ink-2">
          {search.data.total ? fmt(a.hits, { count: search.data.total }) : a.none}
        </Text>
      )}
    </View>
  );
}
