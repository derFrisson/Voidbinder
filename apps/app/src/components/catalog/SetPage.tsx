import type { Game } from '@voidbinder/shared';
import { useEffect } from 'react';
import { Text, View } from 'react-native';
import { useSetPage } from '../../api/queries/catalog';
import { fmt, useLocale, useT } from '../../i18n';
import { recordRecent } from '../../storage/recent';
import { Empty, QueryState } from '../ui';
import { CardCollection } from './Cards';
import { Filters } from './Filters';
import { change, pageCount, toQuery, type SetFilters } from './model';
import { Pagination } from './Pagination';
import { useOwnedPrints, useSetPrices } from './seams';
import { SetHeader, ValueStrip } from './SetHeader';

/** The set page's body: header, value strip, filters, the cards and the pagination. */
export function SetPage({
  game,
  code,
  gameName,
  filters,
  onChange,
}: {
  game: Game;
  code: string;
  gameName: string;
  filters: SetFilters;
  onChange: (next: SetFilters) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const page = useSetPage(game, code, toQuery(filters));
  const owned = useOwnedPrints();
  const prices = useSetPrices();
  const set = page.data?.set;
  useEffect(() => {
    if (set) {
      recordRecent({ kind: 'set', game, code: set.code, name: set.localizedName ?? set.name });
    }
  }, [game, set?.code, set?.name, set?.localizedName]);
  return (
    <QueryState query={page}>
      {(data) => (
        <View className="gap-6">
          <SetHeader data={data} gameName={gameName} owned={owned} />
          <ValueStrip owned={owned} prices={prices} />
          <Filters filters={filters} facets={data.facets} onChange={onChange} />
          <Text role="status" className="font-body text-sm font-semibold text-ink-2">
            {fmt(t.set.results, { count: data.total.toLocaleString(locale), page: data.page })}
          </Text>
          <View className={page.isPlaceholderData ? 'opacity-60' : ''}>
            {data.prints.length === 0 ? (
              <Empty>{t.set.empty}</Empty>
            ) : (
              <CardCollection
                prints={data.prints}
                view={filters.view}
                game={game}
                setCode={data.set.code.toUpperCase()}
                owned={owned}
                prices={prices}
              />
            )}
          </View>
          <Pagination
            page={data.page}
            pages={pageCount(data.total, data.pageSize)}
            onPage={(next) => onChange(change(filters, { page: next }))}
          />
        </View>
      )}
    </QueryState>
  );
}
