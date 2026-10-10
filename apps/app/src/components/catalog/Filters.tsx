import type { SetPageResponse } from '@voidbinder/shared/api';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useT } from '../../i18n';
import { useWide } from '../Shell';
import { Segmented } from '../ui';
import { useFinishLabel, useRarityLabel } from './Cards';
import { SORTS, VIEWS, change, type SetFilters } from './model';

function Chip({
  label,
  count,
  active,
  onPress,
}: {
  label: string;
  count: number;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      role="button"
      aria-pressed={active}
      onPress={onPress}
      className={`h-10 flex-row items-center gap-2 rounded-full border px-4 ${active ? 'border-ink bg-ink' : 'border-line bg-surface'}`}
    >
      <Text className={`font-display text-sm font-semibold ${active ? 'text-page' : 'text-ink'}`}>
        {label}
      </Text>
      <Text className={`font-mono text-xs ${active ? 'text-page' : 'text-ink-2'}`}>{count}</Text>
    </Pressable>
  );
}

/**
 * A row of controls: wrapping on wide screens, one scrolling line on phones (design.md; the next
 * pill peeks in at the edge). `tight` is the spacing of the chips.
 */
function Row({ children, tight = false }: { children: ReactNode; tight?: boolean }) {
  const wide = useWide();
  return wide ? (
    <View className={`flex-row flex-wrap items-end gap-y-3 ${tight ? 'gap-x-2' : 'gap-x-6'}`}>
      {children}
    </View>
  ) : (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View className={`flex-row items-end pb-1 ${tight ? 'gap-2' : 'gap-3'}`}>{children}</View>
    </ScrollView>
  );
}

/** Rarity chips with counts, then language, finish, sort and view (the set page's filter rows). */
export function Filters({
  filters,
  facets,
  onChange,
}: {
  filters: SetFilters;
  facets: SetPageResponse['facets'];
  onChange: (next: SetFilters) => void;
}) {
  const t = useT();
  const wide = useWide();
  const rarity = useRarityLabel();
  const finish = useFinishLabel();
  const languages = [...new Set([...facets.languages, filters.lang])].sort();
  const ALL = '';
  // A rarity from the URL that the set does not have still shows, pressed, so it can be cleared.
  const rarities =
    filters.rarity && !facets.rarities.some((r) => r.rarity === filters.rarity)
      ? [...facets.rarities, { rarity: filters.rarity, count: 0 }]
      : facets.rarities;
  const narrow = (
    <>
      {languages.length > 1 && (
        <Segmented
          label={t.set.language}
          options={languages.map((l) => ({ value: l, label: l.toUpperCase() }))}
          value={filters.lang}
          onChange={(lang) => onChange(change(filters, { lang }))}
        />
      )}
      {(facets.finishes.length > 1 || filters.finish) && (
        <Segmented
          label={t.set.finish}
          options={[
            { value: ALL, label: t.set.all },
            ...facets.finishes.map((f) => ({ value: f.finish, label: finish(f.finish) })),
          ]}
          value={filters.finish ?? ALL}
          onChange={(value) => onChange(change(filters, { finish: value || undefined }))}
        />
      )}
    </>
  );
  const arrange = (
    <>
      <Segmented
        label={t.set.sort}
        options={SORTS.map((s) => ({ value: s, label: t.set.sorts[s] }))}
        value={filters.sort}
        onChange={(sort) => onChange(change(filters, { sort }))}
      />
      <Segmented
        label={t.set.view}
        options={VIEWS.map((v) => ({
          value: v,
          label: v === 'grid' ? t.set.grid : t.set.listView,
        }))}
        value={filters.view}
        onChange={(view) => onChange(change(filters, { view }))}
      />
    </>
  );
  return (
    <View className="gap-4">
      {rarities.length > 0 && (
        <View role="group" aria-label={t.set.rarity} className="gap-2">
          <Text className="font-display text-xs font-semibold uppercase tracking-wider text-ink-2">
            {t.set.rarity}
          </Text>
          <Row tight>
            {rarities.map((r) => (
              <Chip
                key={r.rarity}
                label={rarity(r.rarity)}
                count={r.count}
                active={filters.rarity === r.rarity}
                onPress={() =>
                  onChange(
                    change(filters, { rarity: filters.rarity === r.rarity ? undefined : r.rarity }),
                  )
                }
              />
            ))}
          </Row>
        </View>
      )}
      {wide ? (
        <Row>
          {narrow}
          {arrange}
        </Row>
      ) : (
        <>
          {(languages.length > 1 || facets.finishes.length > 1 || filters.finish) && (
            <Row>{narrow}</Row>
          )}
          {/* Sort and view wrap under it, so nothing of them sits off-screen. */}
          <View className="flex-row flex-wrap items-end gap-x-3 gap-y-3">{arrange}</View>
        </>
      )}
    </View>
  );
}
