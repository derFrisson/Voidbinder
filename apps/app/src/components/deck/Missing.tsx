import type { DeckDetail } from '@voidbinder/shared/api';
import { useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { useWishMissing } from '../../api/queries/decks';
import { fmt, useLocale, useT } from '../../i18n';
import { field } from '../catalog/GameChip';
import { day, money, SOURCE_NAMES } from '../collection/format';
import { Button } from '../ui';
import { copyText, deckText, headline } from './format';

const title = 'font-display text-lg font-bold text-ink';

/**
 * "Was fehlt mir": the copies the collection lacks (by name, any print, every binder) with unit
 * and line prices, what the rest costs per source with its date, and two actions: the missing
 * cards to the wish list (VB-31) and the list as text.
 */
export function Missing({ deck }: { deck: DeckDetail }) {
  const t = useT();
  const locale = useLocale();
  const n = t.decks.need;
  const wish = useWishMissing();
  const [copied, setCopied] = useState(false);
  const { missing, missingValue, collectionCards } = deck.analysis;
  const total = headline(missingValue.totals);
  const count = missing.reduce((sum, m) => sum + m.needed - m.owned, 0);
  // "Rest kostet {amount} nach …": the amount in Sora, the rest as text around it.
  const [before, after] = n.rest.split('{amount}');
  return (
    <View
      role="region"
      aria-label={n.title}
      className="gap-4 rounded-2xl border-2 border-ink bg-surface p-5"
    >
      <View className="flex-row items-center gap-2.5">
        <View aria-hidden className={`h-3 w-3 rounded-[3px] ${field[deck.game].dot}`} />
        <Text role="heading" aria-level={2} className={`${title} flex-1`}>
          {n.title}
        </Text>
        <Text className="font-mono text-sm text-ink-2">{fmt(n.cards, { count })}</Text>
      </View>
      <Text className="font-body text-[13px] leading-5 text-ink-2">
        {fmt(n.sub, { count: collectionCards })}
      </Text>
      {missing.length === 0 ? (
        <Text className="font-body text-[15px] text-ink">{n.none}</Text>
      ) : (
        <>
          <View role="list">
            {missing.map((m) => {
              const qty = m.needed - m.owned;
              return (
                <View
                  key={m.cardId}
                  role="listitem"
                  className="flex-row items-start gap-3 border-b border-line py-2.5"
                >
                  <Text className="w-8 font-mono text-[13px] font-semibold text-ink">{qty}×</Text>
                  <View className="min-w-0 flex-1">
                    <Text className="font-display text-[15px] font-semibold text-ink">
                      {m.name}
                    </Text>
                    <Text className="font-mono text-xs text-ink-2">
                      {[
                        m.setCode && `${m.setCode.toUpperCase()}-${m.displayNumber}`,
                        m.unitPriceCents !== null &&
                          m.currency &&
                          fmt(n.each, { amount: money(m.unitPriceCents, m.currency, locale) }),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  </View>
                  <Text className="font-mono text-[13px] font-semibold text-ink">
                    {m.unitPriceCents !== null && m.currency
                      ? money(m.unitPriceCents * qty, m.currency, locale)
                      : t.decks.noPrice}
                  </Text>
                </View>
              );
            })}
          </View>
          {total && (
            <View className="gap-1 rounded-xl bg-blue-soft p-4">
              <Text className="font-body text-[15px] leading-6 text-ink">
                {before}
                <Text className="font-display text-[22px] font-bold text-ink">
                  {money(total.main.cents, total.main.currency, locale)}
                </Text>
                {fmt(after ?? '', {
                  source: SOURCE_NAMES[total.main.source],
                  date: day(total.main.observedAt, locale),
                })}
              </Text>
              {(total.rest.length > 0 || missingValue.unpriced > 0) && (
                <Text className="font-body text-[13px] text-ink-2">
                  {[
                    ...total.rest.map((r) =>
                      fmt(n.also, {
                        amount: money(r.cents, r.currency, locale),
                        source: SOURCE_NAMES[r.source],
                      }),
                    ),
                    missingValue.unpriced > 0 && fmt(n.unpriced, { count: missingValue.unpriced }),
                  ]
                    .filter(Boolean)
                    .join(' ')}
                </Text>
              )}
            </View>
          )}
          <View className="gap-2">
            <Button
              wide
              label={wish.isSuccess ? `✓ ${n.wished}` : n.wish}
              busy={wish.isPending}
              disabled={wish.isSuccess}
              onPress={() => wish.mutate(missing)}
            />
            {Platform.OS === 'web' && (
              <Button
                wide
                variant="ghost"
                label={copied ? `✓ ${n.copied}` : n.copy}
                onPress={() =>
                  void copyText(
                    deckText(
                      missing.map((m) => ({ quantity: m.needed - m.owned, name: m.englishName })),
                    ),
                  ).then(setCopied)
                }
              />
            )}
            {wish.isError && (
              <Text role="alert" className="font-body text-sm text-ink">
                {n.wishFailed}
              </Text>
            )}
          </View>
        </>
      )}
    </View>
  );
}

/** The curve as quiet ink bars with their counts above and the buckets under them. */
export function Curve({ deck }: { deck: DeckDetail }) {
  const t = useT();
  const { curve } = deck.analysis;
  const max = Math.max(1, ...curve.buckets.map((b) => b.count));
  const total = curve.buckets.reduce((n, b) => n + b.count, 0);
  if (!total) return null;
  const description = curve.buckets
    .map((b) => fmt(t.decks.curve.bar, { label: b.label, count: b.count }))
    .join(', ');
  return (
    <View
      role="region"
      aria-label={t.decks.curve[curve.kind]}
      className="gap-3 rounded-2xl border border-line bg-surface p-5"
    >
      <Text role="heading" aria-level={2} className={title}>
        {t.decks.curve[curve.kind]}
      </Text>
      <View role="img" aria-label={description} className="h-[120px] flex-row items-end gap-2">
        {curve.buckets.map((b) => (
          <View key={b.label} className="h-full flex-1 items-center justify-end gap-1">
            <Text className="font-mono text-[12px] text-ink-2">{b.count}</Text>
            <View
              className={`w-full rounded-t-md ${b.count ? 'bg-ink' : 'bg-surface-2'}`}
              style={{ height: `${Math.max(4, (b.count / max) * 80)}%` }}
            />
          </View>
        ))}
      </View>
      <View aria-hidden className="flex-row gap-2">
        {curve.buckets.map((b) => (
          <Text key={b.label} className="flex-1 text-center font-mono text-[12px] text-ink-2">
            {b.label}
          </Text>
        ))}
      </View>
    </View>
  );
}
