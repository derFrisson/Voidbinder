import type { Game } from '@voidbinder/shared';
import type { CollectionSummary, ValueTotal } from '@voidbinder/shared/api';
import { Text, View } from 'react-native';
import { fmt, useLocale, useT } from '../../i18n';
import { fieldClass } from '../card/game';
import { useWide } from '../Shell';
import { GameSquare } from './Controls';
import { day, money, SOURCE_NAMES } from './format';

const GAMES: Game[] = ['pokemon', 'yugioh', 'mtg', 'onepiece'];

type Group = CollectionSummary['collection'] | CollectionSummary['wishlist'];

/** The big number: the largest sum (one source, one currency), the others as a line under it. */
function useHeadline(totals: ValueTotal[]) {
  const t = useT();
  const locale = useLocale();
  const [main, ...rest] = totals;
  if (!main) return null;
  return {
    main,
    amount: money(main.cents, main.currency, locale),
    note: fmt(t.collection.value.note, {
      source: SOURCE_NAMES[main.source],
      date: day(main.observedAt, locale),
    }),
    also: rest.map((r) =>
      fmt(t.collection.value.also, {
        amount: money(r.cents, r.currency, locale),
        source: SOURCE_NAMES[r.source],
      }),
    ),
  };
}

/** Per game: a bar in the game's colour (ink-free, quiet), the sum in the headline currency. */
function Split({ group, currency }: { group: Group; currency: string }) {
  const t = useT();
  const wide = useWide();
  const locale = useLocale();
  const cents = (game: Game) =>
    group.games
      .find((g) => g.game === game)
      ?.totals.filter((x) => x.currency === currency)
      .reduce((sum, x) => sum + x.cents, 0) ?? 0;
  const max = Math.max(1, ...GAMES.map(cents));
  // Only the games the collection holds (Max, 2026-10-10: no "coming later" row for One Piece).
  const shown = GAMES.filter((g) => group.games.some((x) => x.game === g));
  return (
    <View
      role="list"
      aria-label={t.collection.value.byGame}
      className={`gap-2.5 ${wide ? 'min-w-[300px] flex-1' : ''}`}
    >
      {shown.map((game) => {
        const value = cents(game);
        return (
          <View key={game} role="listitem" className="flex-row items-center gap-3">
            <View className="w-[110px] flex-row items-center gap-2">
              <GameSquare game={game} />
              <Text numberOfLines={1} className="font-display text-sm font-semibold text-ink">
                {t.collection.gameShort[game]}
              </Text>
            </View>
            <View className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
              <View
                style={{ width: `${Math.round((value / max) * 100)}%` }}
                className={`h-full rounded-full ${fieldClass[game].solid}`}
              />
            </View>
            <Text className="w-[96px] text-right font-mono text-sm font-semibold text-ink">
              {money(value, currency, locale)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/** "Sammlungswert" or "Wunschliste kostet": Sora tabular figures, source and date, the split. */
export function ValuePanel({
  summary,
  kind,
}: {
  summary: CollectionSummary;
  kind: 'have' | 'want';
}) {
  const t = useT();
  const locale = useLocale();
  const wide = useWide();
  const group = kind === 'have' ? summary.collection : summary.wishlist;
  const headline = useHeadline(group.totals);
  const v = t.collection.value;
  const games = new Set(group.games.map((g) => g.game)).size;
  const meta =
    kind === 'have'
      ? fmt(games === 1 ? v.cardsOneGame : v.cards, { cards: group.cards, games })
      : fmt(t.collection.wish.count, {
          cards: group.cards,
          inBudget: summary.wishlist.inBudget,
        });
  return (
    <View
      role="region"
      aria-label={kind === 'have' ? v.title : t.collection.wish.title}
      className={`rounded-2xl border border-line bg-surface p-5 ${wide ? 'flex-row items-center gap-10' : 'gap-5'}`}
    >
      <View className={`gap-1.5 ${wide ? 'min-w-0 flex-1' : ''}`}>
        <Text className="font-display text-xs font-semibold uppercase tracking-wider text-ink-2">
          {kind === 'have' ? v.title : t.collection.wish.title}
        </Text>
        {headline ? (
          <Text
            className={`font-display font-extrabold tracking-tighter text-ink ${wide ? 'text-[52px] leading-[56px]' : 'text-[40px] leading-[44px]'}`}
            style={{ fontVariant: ['tabular-nums'] }}
          >
            {headline.amount}
          </Text>
        ) : null}
        <Text className="font-body text-[15px] text-ink-2">{meta}</Text>
        {headline ? (
          <Text className="max-w-[420px] font-body text-[13px] leading-5 text-ink-2">
            {kind === 'have'
              ? headline.note
              : fmt(t.collection.wish.note, {
                  source: SOURCE_NAMES[headline.main.source],
                  date: day(headline.main.observedAt, locale),
                })}
            {kind === 'have' && summary.collection.estimate ? ` ${v.estimate}` : ''}
            {headline.also.map((line) => ` ${line}`).join('')}
            {group.unpriced > 0 ? ` ${fmt(v.unpriced, { count: group.unpriced })}` : ''}
          </Text>
        ) : (
          group.cards > 0 && (
            <Text className="max-w-[420px] font-body text-[13px] leading-5 text-ink-2">
              {v.noPrices}
            </Text>
          )
        )}
      </View>
      {headline && <Split group={group} currency={headline.main.currency} />}
    </View>
  );
}
