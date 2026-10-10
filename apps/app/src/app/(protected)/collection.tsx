import type { Game } from '@voidbinder/shared';
import type { CollectionCondition } from '@voidbinder/shared/api';
import { router } from 'expo-router';
import { createElement, useEffect, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import {
  exportCsvUrl,
  useBinders,
  useCollectionSummary,
  useEntries,
  useWishlist,
} from '../../api/queries/collection';
import { Chip } from '../../components/card/Chip';
import { BinderChips, BinderSidebar, type BinderPick } from '../../components/collection/Binders';
import { Select } from '../../components/collection/Controls';
import { EmptyBinder } from '../../components/collection/EmptyBinder';
import { EntryList, pageValue } from '../../components/collection/Entries';
import { CONDITIONS, LANGUAGES, money } from '../../components/collection/format';
import { ValuePanel } from '../../components/collection/ValuePanel';
import { WishList } from '../../components/collection/Wishlist';
import { Icon } from '../../components/Icon';
import { usePalette } from '../../components/palette';
import { Page, useWide } from '../../components/Shell';
import { Button, Empty, QueryState } from '../../components/ui';
import { fmt, useLocale, useT } from '../../i18n';

type Tab = 'have' | 'want';
type Filters = {
  game?: Game | undefined;
  condition?: CollectionCondition | undefined;
  lang?: string | undefined;
  q?: string | undefined;
};

const GAMES: Game[] = ['pokemon', 'yugioh', 'mtg'];

/** Habe / Will with their counts (copies), a tab list. */
function Tabs({
  tab,
  onTab,
  counts,
}: {
  tab: Tab;
  onTab: (tab: Tab) => void;
  counts: Record<Tab, number | undefined>;
}) {
  const t = useT();
  const wide = useWide();
  return (
    <View
      role="tablist"
      aria-label={t.collection.tabs}
      className={`flex-row gap-1 rounded-xl bg-surface-2 p-1 ${wide ? 'self-start' : ''}`}
    >
      {(['have', 'want'] as const).map((key) => {
        const on = tab === key;
        return (
          <Pressable
            key={key}
            role="tab"
            nativeID={`tab-${key}`}
            aria-selected={on}
            aria-controls={`panel-${key}`}
            onPress={() => onTab(key)}
            className={`h-10 flex-row items-center justify-center gap-2 rounded-lg px-4 ${on ? 'border border-line bg-surface' : ''} ${wide ? '' : 'flex-1'}`}
          >
            <Text
              className={`font-display text-[15px] font-semibold ${on ? 'text-ink' : 'text-ink-2'}`}
            >
              {key === 'have' ? t.collection.have : t.collection.want}
            </Text>
            {counts[key] !== undefined && (
              <Text className="font-mono text-[13px] text-ink-2">{counts[key]}</Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

/** The CSV download: a link on the web (the browser keeps the session cookie); an icon on phones. */
function ExportButton({ compact }: { compact: boolean }) {
  const t = useT();
  const palette = usePalette();
  const content = (
    <>
      <Icon name="download" size={18} color={palette.ink} />
      {!compact && (
        <Text className="font-display text-[15px] font-semibold text-ink">
          {t.collection.exportCsv}
        </Text>
      )}
    </>
  );
  const className = `h-11 flex-row items-center justify-center gap-2 rounded-xl border border-line bg-surface ${compact ? 'w-11' : 'px-4'}`;
  if (Platform.OS === 'web') {
    return createElement(
      'a',
      {
        href: exportCsvUrl,
        download: 'voidbinder-collection.csv',
        title: t.collection.exportHint,
        'aria-label': compact ? t.collection.exportCsv : undefined,
        className: `flex ${className} no-underline`,
      },
      content,
    );
  }
  return (
    <Pressable
      role="link"
      aria-label={t.collection.exportCsv}
      onPress={() => void Linking.openURL(exportCsvUrl)}
      className={className}
    >
      {content}
    </Pressable>
  );
}

function FilterBar({ filters, onChange }: { filters: Filters; onChange: (f: Filters) => void }) {
  const t = useT();
  const wide = useWide();
  const palette = usePalette();
  const f = t.collection.filters;
  const [text, setText] = useState(filters.q ?? '');
  useEffect(() => {
    const q = text.trim() || undefined;
    if (q === filters.q) return;
    const timer = setTimeout(() => onChange({ ...filters, q }), 250);
    return () => clearTimeout(timer);
  }, [text]);
  const chips = (
    <View role="group" aria-label={f.game} className="flex-row gap-2">
      <Chip
        label={f.all}
        pressed={!filters.game}
        onPress={() => onChange({ ...filters, game: undefined })}
      />
      {GAMES.map((g) => (
        <Chip
          key={g}
          label={t.collection.gameShort[g]}
          pressed={filters.game === g}
          onPress={() => onChange({ ...filters, game: filters.game === g ? undefined : g })}
        />
      ))}
    </View>
  );
  const selects = (
    <>
      <Select
        showLabel={false}
        label={f.condition}
        value={filters.condition ?? ''}
        onChange={(c) => onChange({ ...filters, condition: c || undefined })}
        options={[
          { value: '' as const, label: f.anyCondition },
          ...CONDITIONS.map((c) => ({ value: c, label: c })),
        ]}
      />
      <Select
        showLabel={false}
        label={f.language}
        value={filters.lang ?? ''}
        onChange={(lang) => onChange({ ...filters, lang: lang || undefined })}
        options={[
          { value: '', label: f.anyLanguage },
          ...LANGUAGES.map((l) => ({ value: l, label: t.collection.languages[l] ?? l })),
        ]}
      />
    </>
  );
  const search = (
    <View className={`relative justify-center ${wide ? 'w-[240px]' : ''}`}>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder={f.search}
        aria-label={f.search}
        placeholderTextColor={palette.ink3}
        inputMode="search"
        className="h-10 rounded-xl border border-line bg-surface pl-10 pr-3 font-body text-sm text-ink"
      />
      <View className="absolute left-3" pointerEvents="none">
        <Icon name="search" size={16} color={palette.ink3} />
      </View>
    </View>
  );
  if (!wide) {
    return (
      <View role="group" aria-label={f.label} className="gap-3">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-4 px-4">
          <View className="flex-row items-center gap-2 pr-8">
            {chips}
            {selects}
          </View>
        </ScrollView>
        {search}
      </View>
    );
  }
  return (
    <View role="group" aria-label={f.label} className="flex-row flex-wrap items-center gap-2">
      {chips}
      <View className="mx-1 h-6 w-px bg-line" />
      {selects}
      <View className="ml-auto">{search}</View>
    </View>
  );
}

function Pager({
  page,
  pages,
  onPage,
}: {
  page: number;
  pages: number;
  onPage: (page: number) => void;
}) {
  const h = useT().collection.table;
  if (pages <= 1) return null;
  return (
    <View role="navigation" aria-label={h.pagination} className="flex-row items-center gap-3">
      <Button
        variant="ghost"
        label={h.prev}
        disabled={page <= 1}
        onPress={() => onPage(page - 1)}
      />
      <Text className="font-mono text-sm text-ink-2">
        {page} / {pages}
      </Text>
      <Button
        variant="ghost"
        label={h.next}
        disabled={page >= pages}
        onPress={() => onPage(page + 1)}
      />
    </View>
  );
}

function HaveList({ binder, onShowAll }: { binder: BinderPick; onShowAll: () => void }) {
  const t = useT();
  const locale = useLocale();
  const binders = useBinders();
  const [filters, setFilters] = useState<Filters>({});
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [binder, filters]);
  const entries = useEntries({ ...filters, ...(binder && { binder }), page });
  const current = binders.data?.binders.find((b) => b.id === binder);
  const filtered = Object.values(filters).some(Boolean);

  // An empty binder (and no filter that could hide its cards) gets the pocket page.
  if (current && entries.data?.total === 0 && !filtered && !entries.isPlaceholderData) {
    return <EmptyBinder binder={current} onShowAll={onShowAll} />;
  }
  return (
    <View className="gap-4">
      <FilterBar filters={filters} onChange={setFilters} />
      <QueryState
        query={entries}
        isEmpty={(d) => d.total === 0}
        empty={filtered || binder ? t.collection.emptyFiltered : t.collection.empty}
      >
        {(data) => {
          const pages = Math.ceil(data.total / data.pageSize);
          const sums = pageValue(data.entries);
          return (
            <View className={`gap-4 ${entries.isPlaceholderData ? 'opacity-60' : ''}`}>
              <EntryList entries={data.entries} binders={binders.data?.binders ?? []} />
              <View className="flex-row flex-wrap items-center justify-between gap-3 px-1">
                <Text className="font-body text-[13px] text-ink-2">
                  {fmt(t.collection.table.footer, {
                    shown: data.entries.length,
                    total: data.total,
                  })}
                </Text>
                {sums.length > 0 && (
                  <Text className="font-body text-[13px] text-ink-2">
                    {fmt(t.collection.table.pageValue, {
                      amount: sums.map(([c, cents]) => money(cents, c, locale)).join(' + '),
                    })}
                  </Text>
                )}
              </View>
              <Pager page={page} pages={pages} onPage={setPage} />
            </View>
          );
        }}
      </QueryState>
    </View>
  );
}

function WantList() {
  const t = useT();
  const [page, setPage] = useState(1);
  const wishes = useWishlist({ page });
  return (
    <QueryState query={wishes} isEmpty={(d) => d.total === 0} empty={t.collection.wish.empty}>
      {(data) => (
        <View className="gap-4">
          <WishList wishes={data.entries} />
          <Pager page={page} pages={Math.ceil(data.total / data.pageSize)} onPage={setPage} />
        </View>
      )}
    </QueryState>
  );
}

export default function Collection() {
  const t = useT();
  const wide = useWide();
  const [tab, setTab] = useState<Tab>('have');
  const [binder, setBinder] = useState<BinderPick>(null);
  const binders = useBinders();
  const summary = useCollectionSummary();
  const pickBinder = (pick: BinderPick) => {
    setBinder(pick);
    setTab('have');
  };
  const current = binders.data?.binders.find((b) => b.id === binder);
  const counts = { have: summary.data?.collection.cards, want: summary.data?.wishlist.cards };
  const addCards = () => router.push({ pathname: '/search', params: binder ? { binder } : {} });

  const header = (
    <View className={wide ? 'flex-row flex-wrap items-center gap-5' : 'gap-3'}>
      {wide && (
        <Text
          role="heading"
          aria-level={1}
          className="font-display text-[34px] font-bold leading-tight tracking-tight text-ink"
        >
          {t.collection.title}
        </Text>
      )}
      <Tabs
        tab={tab}
        onTab={(next) => {
          setTab(next);
          // Binders hold the have list only.
          if (next === 'want') setBinder(null);
        }}
        counts={counts}
      />
      <View className={`flex-row gap-2 ${wide ? 'ml-auto' : ''}`}>
        <ExportButton compact={!wide} />
        <View className={wide ? '' : 'flex-1'}>
          <Button wide={!wide} label={`+ ${t.collection.addCards}`} onPress={addCards} />
        </View>
      </View>
    </View>
  );

  const panel = (
    <View
      role="tabpanel"
      nativeID={`panel-${tab}`}
      aria-labelledby={`tab-${tab}`}
      className="min-w-0 flex-1 gap-5"
    >
      {!wide && binders.data && (
        <BinderChips
          binders={binders.data.binders}
          summary={summary.data}
          pick={binder}
          onPick={pickBinder}
        />
      )}
      {summary.data && !(tab === 'have' && current) && (
        <ValuePanel summary={summary.data} kind={tab} />
      )}
      {tab === 'have' ? (
        <HaveList binder={binder} onShowAll={() => setBinder(null)} />
      ) : (
        <WantList />
      )}
    </View>
  );

  return (
    <Page
      title={t.collection.title}
      crumbs={[
        { label: t.collection.title, href: '/collection' },
        {
          label: tab === 'want' ? t.collection.want : (current?.name ?? t.collection.allCards),
        },
      ]}
    >
      {header}
      {wide ? (
        <View className="flex-row items-start gap-6">
          {binders.data ? (
            <BinderSidebar
              binders={binders.data.binders}
              summary={summary.data}
              pick={binder}
              onPick={pickBinder}
            />
          ) : (
            <View className="w-[268px]" />
          )}
          {panel}
        </View>
      ) : (
        panel
      )}
      {binders.isError && <Empty>{t.state.error}</Empty>}
    </Page>
  );
}
