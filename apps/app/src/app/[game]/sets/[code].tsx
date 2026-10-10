import { GameSchema, type Game } from '@voidbinder/shared';
import { Link, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { useSetPage } from '../../../api/queries/catalog';
import { Heading, Page } from '../../../components/Shell';
import { Empty, QueryState } from '../../../components/ui';
import { fmt, useLocale, useT } from '../../../i18n';

// VB-56: the final set page (tinted header, value strip, filters, card grid, pagination).
function SetCards({ game, code }: { game: Game; code: string }) {
  const t = useT();
  const page = useSetPage(game, code, { lang: useLocale() });
  return (
    <QueryState query={page}>
      {(data) => (
        <View className="gap-2">
          <Heading>{data.set.localizedName ?? data.set.name}</Heading>
          <Text className="font-body text-ink-2">{fmt(t.set.count, { count: data.total })}</Text>
          {data.prints.length === 0 ? (
            <Empty>{t.set.empty}</Empty>
          ) : (
            data.prints.map((p) => (
              <Link key={p.id} href={`/cards/${p.cardId}`} className="font-body text-ink">
                <Text className="font-mono text-ink-3">{p.number}</Text> {p.name}
              </Link>
            ))
          )}
        </View>
      )}
    </QueryState>
  );
}

export default function SetPage() {
  const t = useT();
  const params = useLocalSearchParams<{ game: string; code: string }>();
  const parsed = GameSchema.safeParse(params.game);
  if (!parsed.success || !params.code) {
    return (
      <Page title={t.state.notFound} back>
        <Empty>{t.state.notFound}</Empty>
      </Page>
    );
  }
  const game = parsed.data;
  const code = params.code.toUpperCase();
  return (
    <Page title={code} back crumbs={[{ label: t.games[game], href: `/${game}` }, { label: code }]}>
      <SetCards game={game} code={params.code} />
    </Page>
  );
}
