import type { Game } from '@voidbinder/shared';
import { Link } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { useGames } from '../api/queries/catalog';
import { Page, Heading, useWide } from '../components/Shell';
import { ErrorState } from '../components/ui';
import { fmt, useT } from '../i18n';

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

export default function Home() {
  const t = useT();
  const games = useGames();
  const counts = new Map(games.data?.games.map((g) => [g.id, g.setCount]));
  return (
    <Page title={t.home.title}>
      <Heading lede={t.home.lede}>{t.home.title}</Heading>
      <View className="flex-row flex-wrap gap-4">
        {order.map((game) => (
          <Tile key={game} game={game} sets={games.data ? (counts.get(game) ?? 0) : undefined} />
        ))}
      </View>
      {games.isError && <ErrorState onRetry={() => void games.refetch()} />}
    </Page>
  );
}
