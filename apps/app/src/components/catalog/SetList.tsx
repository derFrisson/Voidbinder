import type { Game } from '@voidbinder/shared';
import type { SetSummary } from '@voidbinder/shared/api';
import { Link } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSets } from '../../api/queries/catalog';
import { fmt, useLocale, useT } from '../../i18n';
import { useWide } from '../Shell';
import { Empty, Field, QueryState, Segmented } from '../ui';
import { SET_SORTS, formatDate, groupSets, type SetListSort } from './model';

const dot: Record<Game, string> = {
  pokemon: 'bg-pk',
  yugioh: 'bg-yg',
  mtg: 'bg-mg',
  onepiece: 'bg-op',
};

/** The sets of a game, newest first and grouped by year, with a text filter and a sort. */
export function SetList({ game }: { game: Game }) {
  const t = useT();
  const locale = useLocale();
  const sets = useSets(game, locale);
  const [text, setText] = useState('');
  const [sort, setSort] = useState<SetListSort>('newest');
  const wide = useWide();
  const cards = (n: number | null) =>
    n ? fmt(n === 1 ? t.game.cardOne : t.game.cards, { count: n }) : '';
  // Phones: date and card count under the name.
  const meta = (s: SetSummary) =>
    [s.releasedOn ? formatDate(s.releasedOn, locale) : '', cards(s.cardCount)]
      .filter(Boolean)
      .join(' · ');
  const all = sets.data?.sets;
  const groups = useMemo(() => groupSets(all ?? [], text, sort), [all, text, sort]);
  const shown = groups.reduce((n, g) => n + g.sets.length, 0);
  return (
    <QueryState query={sets} isEmpty={(d) => d.sets.length === 0} empty={t.game.empty}>
      {(data) => (
        <View className="gap-6">
          <View className="flex-row flex-wrap items-end gap-x-6 gap-y-4">
            <View className="min-w-[240px] max-w-[420px] flex-1">
              <Field
                label={t.game.filter}
                placeholder={t.game.filterHint}
                value={text}
                onChangeText={setText}
                autoCapitalize="none"
                autoCorrect={false}
                enterKeyHint="search"
              />
            </View>
            <Segmented
              label={t.game.sort}
              options={SET_SORTS.map((s) => ({ value: s, label: t.game.sorts[s] }))}
              value={sort}
              onChange={setSort}
            />
          </View>
          <Text role="status" className="font-body text-sm font-semibold text-ink-2">
            {text.trim()
              ? fmt(t.game.shown, { shown, count: data.sets.length })
              : fmt(t.game.count, { count: data.sets.length })}
          </Text>
          {groups.length === 0 ? (
            <Empty>{fmt(t.game.noMatch, { text: text.trim() })}</Empty>
          ) : (
            groups.map((g) => (
              <View
                key={g.year ?? 'all'}
                role="group"
                aria-label={g.year ?? t.game.list}
                className="gap-2"
              >
                {g.year !== null && (
                  <Text
                    role="heading"
                    aria-level={2}
                    className="font-display text-xl font-bold text-ink"
                  >
                    {g.year || t.game.undated}
                  </Text>
                )}
                <View
                  role="list"
                  className="overflow-hidden rounded-2xl border border-line bg-surface"
                >
                  {g.sets.map((s, i) => (
                    <View key={s.code} role="listitem">
                      <Link href={`/${game}/sets/${s.code}`} asChild>
                        <Pressable
                          className={`min-h-[60px] flex-row items-center gap-4 px-4 py-2.5 ${i > 0 ? 'border-t border-line' : ''}`}
                        >
                          <View className={`h-2.5 w-2.5 rounded-full ${dot[game]}`} />
                          <Text className="w-14 font-mono text-[13px] font-medium text-ink-2">
                            {s.code.toUpperCase()}
                          </Text>
                          <View className="flex-1 gap-0.5">
                            <Text
                              numberOfLines={2}
                              className="font-display text-[15px] font-semibold text-ink"
                            >
                              {s.localizedName ?? s.name}
                            </Text>
                            {!wide && (
                              <Text className="font-body text-[13px] text-ink-2">{meta(s)}</Text>
                            )}
                          </View>
                          {wide && (
                            <>
                              <Text className="font-mono text-[13px] text-ink-2">
                                {s.releasedOn ? formatDate(s.releasedOn, locale) : ''}
                              </Text>
                              <Text className="w-24 text-right font-body text-[13px] text-ink-2">
                                {cards(s.cardCount)}
                              </Text>
                            </>
                          )}
                        </Pressable>
                      </Link>
                    </View>
                  ))}
                </View>
              </View>
            ))
          )}
        </View>
      )}
    </QueryState>
  );
}
