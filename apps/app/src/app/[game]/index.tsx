import { GameSchema } from '@voidbinder/shared';
import { useLocalSearchParams } from 'expo-router';
import { GameChip } from '../../components/catalog/GameChip';
import { SetList } from '../../components/catalog/SetList';
import { Heading, Page } from '../../components/Shell';
import { Empty } from '../../components/ui';
import { useT } from '../../i18n';

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
      <GameChip game={game} name={t.games[game]} />
      <Heading>{t.games[game]}</Heading>
      <SetList game={game} />
    </Page>
  );
}
