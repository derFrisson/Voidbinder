import type { Game } from '@voidbinder/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useSession } from '../api/queries/me';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ScrollView, Text, TextInput, View, useWindowDimensions } from 'react-native';
import {
  fromParams,
  searchable,
  toParams,
  updateSearch,
  useSearch,
  type SearchState,
} from '../api/queries/search';
import { label } from '../components/card/attributes';
import { Chip } from '../components/card/Chip';
import { PrintTile, TileSkeleton } from '../components/card/PrintTile';
import { QuickAdd } from '../components/collection/CollectButtons';
import { SetPicker } from '../components/card/SetPicker';
import { Heading, Page, useWide } from '../components/Shell';
import { SearchLead, useTypeahead } from '../components/Typeahead';
import { Button, Empty, ErrorState } from '../components/ui';
import { usePalette } from '../components/palette';
import { fmt, useLocale, useT } from '../i18n';

// The games with a catalog (One Piece comes later), their common rarities (exact values of
// `prints.rarity`; Magic's are slugs with a translation) and the finishes the importers write.
const GAMES: Game[] = ['pokemon', 'yugioh', 'mtg'];
const RARITIES: Record<Game, string[]> = {
  mtg: ['common', 'uncommon', 'rare', 'mythic'],
  pokemon: ['Common', 'Uncommon', 'Rare', 'Ultra Rare', 'Secret Rare', 'Promo'],
  yugioh: ['Common', 'Rare', 'Super Rare', 'Ultra Rare', 'Secret Rare'],
  onepiece: [],
};
const FINISHES: Record<Game, string[]> = {
  mtg: ['normal', 'foil', 'etched'],
  pokemon: ['normal', 'reverse', 'holo', 'first_edition'],
  yugioh: [],
  onepiece: [],
};
// Proper names that exist in the catalog, as a start.
const EXAMPLES = ['Adeline', 'Dark Magician', 'Pikachu'];

/** Dense grid as on the set page: 7 columns at 1240 px, 3 on a phone. */
function useColumns() {
  const width = useWindowDimensions().width;
  return width >= 1240 ? 7 : width >= 1024 ? 5 : width >= 768 ? 4 : 3;
}

function Grid({ children }: { children: ReactNode[] }) {
  const columns = useColumns();
  return (
    <View className="-mx-1.5 flex-row flex-wrap gap-y-5">
      {children.map((child, i) => (
        <View key={i} style={{ width: `${100 / columns}%` }} className="px-1.5">
          {child}
        </View>
      ))}
    </View>
  );
}

/** One filter row: an uppercase label, then chips (scrolling sideways on a phone). */
function FilterRow({ label, children }: { label: string; children: ReactNode }) {
  const wide = useWide();
  const chips = <View className="flex-row flex-wrap gap-2">{children}</View>;
  return (
    <View role="group" aria-label={label} className={wide ? 'flex-row items-start gap-4' : 'gap-2'}>
      <Text className="w-28 pt-2 font-display text-[11.5px] font-semibold uppercase tracking-wider text-ink-3">
        {label}
      </Text>
      {wide ? (
        <View className="flex-1">{chips}</View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-4 px-4">
          <View className="flex-row gap-2 pr-8">{children}</View>
        </ScrollView>
      )}
    </View>
  );
}

function Filters({
  state,
  set,
}: {
  state: SearchState;
  set: (patch: Partial<SearchState>) => void;
}) {
  const t = useT();
  const game = state.game;
  return (
    <View className="gap-3">
      <FilterRow label={t.search.game}>
        {GAMES.map((g) => (
          <Chip
            key={g}
            label={t.games[g]}
            pressed={game === g}
            onPress={() => set({ game: game === g ? undefined : g })}
          />
        ))}
      </FilterRow>
      {game && (
        <FilterRow label={t.search.set}>
          <SetPicker game={game} value={state.set} onChange={(code) => set({ set: code })} />
        </FilterRow>
      )}
      {game && RARITIES[game].length > 0 && (
        <FilterRow label={t.search.rarity}>
          {RARITIES[game].map((r) => (
            <Chip
              key={r}
              label={label(t.card.rarities, r)}
              pressed={state.rarity === r}
              onPress={() => set({ rarity: state.rarity === r ? undefined : r })}
            />
          ))}
        </FilterRow>
      )}
      {game && FINISHES[game].length > 0 && (
        <FilterRow label={t.search.finish}>
          {FINISHES[game].map((f) => (
            <Chip
              key={f}
              label={label(t.card.finishes, f)}
              pressed={state.finish === f}
              onPress={() => set({ finish: state.finish === f ? undefined : f })}
            />
          ))}
        </FilterRow>
      )}
      <FilterRow label={t.search.language}>
        <Chip
          label={t.search.allLanguages}
          pressed={!state.names}
          onPress={() => set({ names: undefined })}
        />
        {(['de', 'en'] as const).map((l) => (
          <Chip
            key={l}
            label={l.toUpperCase()}
            pressed={state.names === l}
            onPress={() => set({ names: l })}
          />
        ))}
      </FilterRow>
    </View>
  );
}

function Results({
  state,
  set,
  onExample,
}: {
  state: SearchState;
  set: (patch: Partial<SearchState>) => void;
  onExample: (q: string) => void;
}) {
  const t = useT();
  const search = useSearch(state);
  // VB-31: signed in, every result can go straight into the collection (into the binder the
  // search was opened from, `?binder=`).
  const { data: me } = useSession();
  const binder = useLocalSearchParams<{ binder?: string }>().binder;
  const columns = useColumns();
  const filtered = !!(state.game || state.set || state.rarity || state.finish || state.names);

  if (!searchable(state.q)) {
    return (
      <View className="gap-3">
        <Text className="font-body text-[15px] text-ink-2">{t.search.start}</Text>
        <View className="flex-row flex-wrap items-center gap-2">
          <Text className="font-body text-sm text-ink-3">{t.search.examples}</Text>
          {EXAMPLES.map((q) => (
            <Chip key={q} label={q} pressed={false} onPress={() => onExample(q)} />
          ))}
        </View>
      </View>
    );
  }
  if (search.isPending) {
    return (
      <View role="status" aria-label={t.state.loading}>
        <Grid>
          {Array.from({ length: columns * 2 }, (_, i) => (
            <TileSkeleton key={i} />
          ))}
        </Grid>
      </View>
    );
  }
  if (search.isError || !search.data) return <ErrorState onRetry={() => void search.refetch()} />;

  const { prints, total, pageSize, page } = search.data;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <View className={`gap-5 ${search.isPlaceholderData ? 'opacity-60' : ''}`}>
      <Text role="status" className="font-body text-sm text-ink-2">
        {fmt(t.search.count, { count: total })}
        {total > pageSize ? ` · ${fmt(t.search.pageOf, { page, pages })}` : ''}
      </Text>
      {prints.length === 0 ? (
        <View className="gap-4">
          <Empty>
            {fmt(t.search.none, { q: state.q })} {t.search.noneHint}
          </Empty>
          {filtered && (
            <Button
              variant="ghost"
              label={t.search.clearFilters}
              onPress={() =>
                set({
                  game: undefined,
                  set: undefined,
                  rarity: undefined,
                  finish: undefined,
                  names: undefined,
                })
              }
            />
          )}
        </View>
      ) : (
        <Grid>
          {prints.map((hit) =>
            me ? (
              <View key={hit.id} className="gap-2">
                <PrintTile hit={hit} />
                <QuickAdd
                  printId={hit.id}
                  cardId={hit.cardId}
                  name={hit.name}
                  finish={hit.finishes[0] ?? 'normal'}
                  binderId={binder}
                />
              </View>
            ) : (
              <PrintTile key={hit.id} hit={hit} />
            ),
          )}
        </Grid>
      )}
      {pages > 1 && (
        <View
          role="navigation"
          aria-label={t.search.pagination}
          className="flex-row items-center gap-3"
        >
          <Button
            variant="ghost"
            label={t.search.prev}
            disabled={page <= 1}
            onPress={() => set({ page: page - 1 })}
          />
          <Text className="font-mono text-sm text-ink-2">
            {page} / {pages}
          </Text>
          <Button
            variant="ghost"
            label={t.search.next}
            disabled={page >= pages}
            onPress={() => set({ page: page + 1 })}
          />
        </View>
      )}
    </View>
  );
}

export default function Search() {
  const t = useT();
  const locale = useLocale();
  const palette = usePalette();
  const wide = useWide();
  const state = fromParams(useLocalSearchParams(), locale);
  const set = (patch: Partial<SearchState>) =>
    router.setParams(toParams(updateSearch(state, patch), locale));

  // The field updates the URL 250 ms after the last keystroke. A `q` the field did not send
  // (the top bar's search, back and forward) replaces its text.
  const [text, setText] = useState(state.q);
  const sent = useRef(state.q);
  useEffect(() => {
    if (state.q !== sent.current) {
      sent.current = state.q;
      setText(state.q);
    }
  }, [state.q]);
  // The latest `set`: a filter changed while the timer runs must not be undone by it.
  const latest = useRef(set);
  latest.current = set;
  const send = (q: string) => {
    sent.current = q;
    latest.current({ q });
  };
  useEffect(() => {
    const q = text.trim();
    if (q === sent.current) return;
    const timer = setTimeout(() => send(q), 250);
    return () => clearTimeout(timer);
  }, [text]);

  // Phones have no top bar, so this box carries the typeahead there (VB-79), full width.
  const typeahead = useTypeahead({ text, onChangeText: setText, enabled: !wide });

  return (
    <Page title={t.search.title}>
      <Heading>{t.search.title}</Heading>
      {/* The input is the whole box, so the focus ring is the box. */}
      <View className="relative z-10 justify-center">
        <TextInput
          value={text}
          {...typeahead.inputProps}
          onSubmitEditing={() => send(text.trim())}
          autoFocus
          placeholder={t.search.placeholder}
          aria-label={t.search.field}
          placeholderTextColor={palette.ink3}
          inputMode="search"
          enterKeyHint="search"
          autoCorrect={false}
          maxLength={80}
          className="h-12 rounded-xl border border-line bg-surface pl-12 pr-4 font-body text-base text-ink"
        />
        <View className="absolute left-4" pointerEvents="none">
          <SearchLead busy={typeahead.busy} size={20} />
        </View>
        {typeahead.list}
        {typeahead.live}
      </View>
      <Filters state={state} set={set} />
      <Results
        state={state}
        set={set}
        onExample={(q) => {
          setText(q);
          send(q);
        }}
      />
    </Page>
  );
}
