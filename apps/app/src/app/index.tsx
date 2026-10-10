import type { Game } from '@voidbinder/shared';
import { Link, router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useGames, useNewSets } from '../api/queries/catalog';
import { formatDate } from '../components/catalog/model';
import { Icon } from '../components/Icon';
import { usePalette } from '../components/palette';
import { Page, Heading, useWide } from '../components/Shell';
import { Button, ErrorState } from '../components/ui';
import { fmt, useLocale, useT } from '../i18n';
import { useRecents } from '../storage/recent';

// The game's colour field (docs/app/design.md): a soft tint with the full colour as a dot, never text.
const field: Record<Game, { tint: string; dot: string }> = {
  pokemon: { tint: 'bg-pk-soft', dot: 'bg-pk' },
  yugioh: { tint: 'bg-yg-soft', dot: 'bg-yg' },
  mtg: { tint: 'bg-mg-soft', dot: 'bg-mg' },
  onepiece: { tint: 'bg-op-soft', dot: 'bg-op' },
};

const order: Game[] = ['pokemon', 'yugioh', 'mtg', 'onepiece'];

function Tile({ game, sets }: { game: Game; sets: number | undefined }) {
  const t = useT();
  const wide = useWide();
  const later = game === 'onepiece';
  const meta = later
    ? t.home.later
    : sets
      ? fmt(t.home.sets, { count: sets })
      : sets === 0
        ? t.home.noSets
        : ' ';
  const body = (
    <View
      className={`min-h-[148px] justify-between gap-6 rounded-2xl border border-line p-5 ${field[game].tint}`}
    >
      <View className={`h-3 w-3 rounded-full ${field[game].dot}`} />
      <View className="gap-1">
        <Text className="font-display text-[22px] font-bold tracking-tight text-ink">
          {t.games[game]}
        </Text>
        <Text className={`text-sm text-ink-2 ${sets ? 'font-mono' : 'font-body'}`}>{meta}</Text>
      </View>
    </View>
  );
  const size = wide ? 'min-w-[200px] flex-1 basis-0' : 'w-full';
  if (later) {
    return (
      <View aria-disabled className={`${size} opacity-70`}>
        {body}
      </View>
    );
  }
  return (
    <Link href={`/${game}`} asChild>
      <Pressable aria-label={`${t.games[game]}, ${meta}`} className={`${size} rounded-2xl`}>
        {body}
      </Pressable>
    </Link>
  );
}

/** The search entry: submitting opens /search with the text (the search screen is VB-35). */
function SearchEntry() {
  const t = useT();
  const palette = usePalette();
  const [q, setQ] = useState('');
  const go = () => router.push({ pathname: '/search', params: q.trim() ? { q: q.trim() } : {} });
  return (
    <View className="max-w-[640px] flex-row items-center gap-3">
      <View className="h-12 flex-1 flex-row items-center gap-2.5 rounded-xl border border-line bg-surface px-3.5">
        <Icon name="search" size={20} color={palette.ink3} />
        <TextInput
          value={q}
          onChangeText={setQ}
          onSubmitEditing={go}
          placeholder={t.top.search}
          aria-label={t.top.search}
          placeholderTextColor={palette.ink3}
          enterKeyHint="search"
          className="h-full flex-1 font-body text-[15px] text-ink"
        />
      </View>
      <Button label={t.home.search} onPress={go} />
    </View>
  );
}

/** The last sets and cards opened on this device ("zuletzt angesehen"). */
function Recent() {
  const t = useT();
  const recents = useRecents();
  if (recents.length === 0) return null;
  return (
    <View role="region" aria-label={t.home.recent} className="gap-3">
      <Text role="heading" aria-level={2} className="font-display text-xl font-bold text-ink">
        {t.home.recent}
      </Text>
      <View role="list" className="flex-row flex-wrap gap-3">
        {recents.map((r) => (
          <View key={r.kind === 'set' ? `s:${r.game}:${r.code}` : `c:${r.id}`} role="listitem">
            <Link href={r.kind === 'set' ? `/${r.game}/sets/${r.code}` : `/cards/${r.id}`} asChild>
              <Pressable className="min-h-[56px] max-w-[280px] justify-center gap-0.5 rounded-xl border border-line bg-surface px-4 py-2.5">
                <Text className="font-body text-xs text-ink-3">
                  {r.kind === 'set'
                    ? `${t.home.recentSet} · ${t.games[r.game]}`
                    : `${t.home.recentCard} · ${t.games[r.game]}`}
                </Text>
                <Text numberOfLines={1} className="font-display text-[15px] font-semibold text-ink">
                  {r.kind === 'set' ? (
                    <Text className="font-mono text-[13px] text-ink-2">
                      {r.code.toUpperCase()}{' '}
                    </Text>
                  ) : null}
                  {r.name}
                </Text>
              </Pressable>
            </Link>
          </View>
        ))}
      </View>
    </View>
  );
}

/** Sets released (or first imported, when undated) in the last 30 days, every game's (VB-83). */
function NewSets() {
  const t = useT();
  const locale = useLocale();
  const sets = useNewSets(locale).data?.sets;
  if (!sets?.length) return null;
  return (
    <View role="region" aria-label={t.home.fresh} className="gap-3">
      <Text role="heading" aria-level={2} className="font-display text-xl font-bold text-ink">
        {t.home.fresh}
      </Text>
      <View role="list" className="flex-row flex-wrap gap-3">
        {sets.map((s) => (
          <View key={`${s.game}:${s.code}`} role="listitem">
            <Link href={`/${s.game}/sets/${s.code}`} asChild>
              <Pressable className="min-h-[56px] max-w-[280px] justify-center gap-0.5 rounded-xl border border-line bg-surface px-4 py-2.5">
                <View className="flex-row items-center gap-2">
                  <View className={`h-2 w-2 rounded-full ${field[s.game].dot}`} />
                  <Text className="font-body text-xs text-ink-3">
                    {[t.games[s.game], s.releasedOn && formatDate(s.releasedOn, locale)]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                </View>
                <Text numberOfLines={1} className="font-display text-[15px] font-semibold text-ink">
                  <Text className="font-mono text-[13px] text-ink-2">{s.code.toUpperCase()} </Text>
                  {s.localizedName ?? s.name}
                </Text>
              </Pressable>
            </Link>
          </View>
        ))}
      </View>
    </View>
  );
}

export default function Home() {
  const t = useT();
  const games = useGames();
  const counts = new Map(games.data?.games.map((g) => [g.id, g.setCount]));
  return (
    <Page title={t.home.title}>
      <Heading lede={t.home.lede}>{t.home.title}</Heading>
      <SearchEntry />
      <View className="flex-row flex-wrap gap-4">
        {order.map((game) => (
          <Tile key={game} game={game} sets={games.data ? (counts.get(game) ?? 0) : undefined} />
        ))}
      </View>
      {games.isError && <ErrorState onRetry={() => void games.refetch()} />}
      <Recent />
      <NewSets />
    </Page>
  );
}
