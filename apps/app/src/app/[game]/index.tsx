import { GameSchema, type Game } from '@voidbinder/shared';
import { Link, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { useSets } from '../../api/queries/catalog';
import { Heading, Page } from '../../components/Shell';
import { Empty, QueryState } from '../../components/ui';
import { fmt, useLocale, useT } from '../../i18n';

// VB-56: the final set list (code, release date, card count, completion when signed in).
function Sets({ game }: { game: Game }) {
  const t = useT();
  const sets = useSets(game, useLocale());
  return (
    <QueryState query={sets} isEmpty={(d) => d.sets.length === 0} empty={t.game.empty}>
      {(data) => (
        <View className="gap-2">
          <Text className="font-body text-ink-2">
            {fmt(t.game.count, { count: data.sets.length })}
          </Text>
          {data.sets.map((s) => (
            <Link key={s.code} href={`/${game}/sets/${s.code}`} className="font-body text-ink">
              <Text className="font-mono text-ink-3">{s.code.toUpperCase()}</Text>{' '}
              {s.localizedName ?? s.name}
            </Link>
          ))}
        </View>
      )}
    </QueryState>
  );
}

export default function GameSets() {
  const t = useT();
  const parsed = GameSchema.safeParse(useLocalSearchParams<{ game: string }>().game);
  if (!parsed.success) {
    return (
      <Page title={t.state.notFound} back>
        <Empty>{t.state.notFound}</Empty>
      </Page>
    );
  }
  const game = parsed.data;
  return (
    <Page title={t.games[game]} back crumbs={[{ label: t.games[game] }]}>
      <Heading>{t.games[game]}</Heading>
      <Sets game={game} />
    </Page>
  );
}
