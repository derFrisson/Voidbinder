import { GameSchema } from '@voidbinder/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { Page } from '../../../components/Shell';
import { Empty } from '../../../components/ui';
import { SetPage } from '../../../components/catalog/SetPage';
import { parseFilters, toParams, type SetFilters } from '../../../components/catalog/model';
import { useLocale, useT } from '../../../i18n';

export default function SetRoute() {
  const t = useT();
  const locale = useLocale();
  const params = useLocalSearchParams<Record<string, string>>();
  const parsed = GameSchema.safeParse(params.game);
  // The filters live in the URL, so a filtered set page can be linked and reloaded.
  const filters = parseFilters(params, locale);
  if (!parsed.success || !params.code) {
    return (
      <Page title={t.state.notFound} back>
        <Empty>{t.state.notFound}</Empty>
      </Page>
    );
  }
  const game = parsed.data;
  const code = params.code.toUpperCase();
  const onChange = (next: SetFilters) =>
    router.setParams({
      lang: undefined,
      rarity: undefined,
      finish: undefined,
      sort: undefined,
      page: undefined,
      view: undefined,
      ...toParams(next, locale),
    });
  return (
    <Page
      title={code}
      back
      catalog
      crumbs={[{ label: t.games[game], href: `/${game}` }, { label: code }]}
    >
      <SetPage
        game={game}
        code={params.code}
        gameName={t.games[game]}
        filters={filters}
        onChange={onChange}
      />
    </Page>
  );
}
