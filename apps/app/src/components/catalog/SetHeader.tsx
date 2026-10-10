import type { SetPageResponse } from '@voidbinder/shared/api';
import { Text, View } from 'react-native';
import { fmt, useLocale, useT } from '../../i18n';
import { useWide } from '../Shell';
import { Panel } from '../ui';
import { useFinishLabel } from './Cards';
import { field, GameChip } from './GameChip';
import { completion, finishTotals, formatDate, setValue, type Owned } from './model';
import { formatPrice, type PriceTag } from './seams';

const label = 'font-display text-xs font-semibold uppercase tracking-wider';

function Fact({ name, children }: { name: string; children: string }) {
  return (
    <View className="gap-1">
      {/* ink, not ink-2: the label can sit on the decorative circle, which darkens the tint. */}
      <Text className={`${label} text-ink`}>{name}</Text>
      <Text className="font-mono text-[15px] font-medium text-ink">{children}</Text>
    </View>
  );
}

/** The game-coloured header of a set: code, release, card count, languages, completion. */
export function SetHeader({
  data,
  gameName,
  owned,
}: {
  data: SetPageResponse;
  gameName: string;
  /** The user's copies in this set; undefined while signed out. */
  owned: Owned | undefined;
}) {
  const t = useT();
  const locale = useLocale();
  const wide = useWide();
  const finish = useFinishLabel();
  const { set, facets } = data;
  const name = set.localizedName ?? set.name;
  const done = owned ? completion(owned, set.cardCount) : undefined;
  const parts = owned
    ? Object.entries(finishTotals(owned)).map(([f, n]) => `${finish(f)} ${n}`)
    : [];
  return (
    <View
      className={`overflow-hidden rounded-3xl p-6 ${wide ? 'gap-5 p-8' : 'gap-4'} ${field[set.game].tint}`}
    >
      <View
        aria-hidden
        className={`absolute -right-20 -top-24 h-[340px] w-[340px] rounded-full opacity-30 ${field[set.game].dot}`}
      />
      <GameChip game={set.game} name={gameName} />
      <Text
        role={wide ? 'heading' : undefined}
        aria-level={wide ? 1 : undefined}
        className={`font-display font-extrabold leading-none tracking-tighter text-ink ${wide ? 'text-[52px]' : 'text-[34px]'}`}
      >
        {name}
      </Text>
      <View className="flex-row flex-wrap gap-x-8 gap-y-3">
        <Fact name={t.set.code}>{set.code.toUpperCase()}</Fact>
        {set.releasedOn && <Fact name={t.set.released}>{formatDate(set.releasedOn, locale)}</Fact>}
        {set.cardCount ? <Fact name={t.set.cards}>{String(set.cardCount)}</Fact> : null}
        {facets.languages.length > 0 && (
          <Fact name={t.set.languages}>
            {facets.languages.map((l) => l.toUpperCase()).join(' · ')}
          </Fact>
        )}
      </View>
      {done && (
        <View className="gap-2">
          <View className="flex-row items-center gap-4">
            <Text className="font-display text-[34px] font-extrabold text-ink">
              {done.owned}
              <Text className="text-ink-2"> / {set.cardCount}</Text>
            </Text>
            <View
              role="progressbar"
              aria-label={t.set.completion}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(done.ratio * 100)}
              className="h-3 max-w-[540px] flex-1 overflow-hidden rounded-full bg-surface"
            >
              <View
                className="h-full rounded-full bg-ink"
                style={{ width: `${done.ratio * 100}%` }}
              />
            </View>
            <Text className="font-mono text-sm text-ink">{Math.round(done.ratio * 100)} %</Text>
          </View>
          {parts.length > 0 && (
            <Text className="font-body text-sm text-ink-2">{parts.join(' · ')}</Text>
          )}
        </View>
      )}
    </View>
  );
}

/** Value of the user's cards and of the missing ones; only with a collection and prices. */
export function ValueStrip({
  owned,
  prices,
}: {
  owned: Owned | undefined;
  prices: ReadonlyMap<string, PriceTag> | undefined;
}) {
  const t = useT();
  const locale = useLocale();
  const value = owned && prices ? setValue(owned, prices) : null;
  if (!value) return null;
  const money = (cents: number) => formatPrice({ ...value, cents }, locale);
  return (
    <Panel className="gap-4">
      <View className="flex-row flex-wrap gap-x-10 gap-y-4">
        <View className="gap-1">
          <Text className={`${label} text-ink-2`}>
            {fmt(t.set.valueOwned, { count: value.ownedCount })}
          </Text>
          <Text className="font-display text-[26px] font-bold text-ink">
            {money(value.ownedCents)}
          </Text>
        </View>
        <View className="gap-1">
          <Text className={`${label} text-ink-2`}>
            {fmt(t.set.valueMissing, { count: value.missingCount })}
          </Text>
          <Text className="font-display text-[26px] font-bold text-ink">
            {money(value.missingCents)}
          </Text>
        </View>
      </View>
      <View className="gap-1">
        <Text className={`${label} text-ink-2`}>{t.set.valueSource}</Text>
        <Text className="font-body text-sm text-ink-2">
          {fmt(t.set.valueAsOf, { source: value.source, date: formatDate(value.asOf, locale) })}
        </Text>
      </View>
    </Panel>
  );
}
