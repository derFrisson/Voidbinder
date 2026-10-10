import type { Locale } from '@voidbinder/shared';
import { useState, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import {
  usePriceHistory,
  usePrintPrices,
  type Price,
  type PricePoint,
  type PrintPrices,
} from '../../api/queries/cards';
import { fmt, useLocale, useT } from '../../i18n';
import { Segmented } from '../ui';
import { formatDate, label } from './attributes';
import { PriceLine } from './PriceLine';

const money = (cents: number, currency: string, locale: Locale) =>
  new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100);

const dateTime = (iso: string, locale: Locale) =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );

// Cardmarket (EUR) and TCGplayer (USD), side by side; TCGplayer's price may come via Scryfall.
const SOURCES = [
  { name: 'Cardmarket', match: ['cardmarket'] },
  { name: 'TCGplayer', match: ['tcgplayer', 'tcgplayer_scryfall'] },
] as const;

const pick = (prices: PrintPrices | null, i: 0 | 1, finish: string) =>
  prices?.prices.find(
    (p) => (SOURCES[i].match as readonly string[]).includes(p.source) && p.finish === finish,
  );

/** A panel of the card page (the mockup's `.panel`): heading, optional controls, content. */
export function Section({
  title,
  aside,
  className = '',
  children,
}: {
  title: string;
  aside?: ReactNode;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <View className={`gap-4 rounded-[20px] border border-line bg-surface p-5 ${className}`}>
      <View className="flex-row flex-wrap items-end justify-between gap-3">
        <Text role="heading" aria-level={2} className="font-display text-[17px] font-bold text-ink">
          {title}
        </Text>
        {aside}
      </View>
      {children}
    </View>
  );
}

function SourceColumn({ i, price }: { i: 0 | 1; price: Price | undefined }) {
  const t = useT();
  const locale = useLocale();
  return (
    <View className="min-w-[220px] flex-1 gap-3 rounded-2xl bg-surface-2 p-4">
      <View className="flex-row items-baseline justify-between">
        <Text className="font-display text-sm font-semibold text-ink">{SOURCES[i].name}</Text>
        <Text className="font-mono text-xs text-ink-3">{i === 0 ? 'EUR' : 'USD'}</Text>
      </View>
      {price ? (
        <>
          <View className="flex-row items-baseline gap-2.5">
            <Text className="font-display text-xs font-semibold text-ink-2">
              {i === 0 ? t.prices.trend : t.prices.market}
            </Text>
            <Text className="font-mono text-[28px] font-bold tracking-tight text-ink">
              {money(price.market, price.currency, locale)}
            </Text>
          </View>
          {price.low !== null && (
            <View className="flex-row justify-between">
              <Text className="font-body text-[13.5px] text-ink-2">{t.prices.low}</Text>
              <Text className="font-mono text-[13.5px] font-semibold text-ink">
                {money(price.low, price.currency, locale)}
              </Text>
            </View>
          )}
          <Text className="border-t border-line pt-2.5 font-body text-[12.5px] text-ink-3">
            {[
              label(t.card.finishes, price.finish),
              t.prices.nearMint,
              fmt(t.prices.asOf, { date: dateTime(price.observedAt, locale) }),
            ].join(' · ')}
          </Text>
        </>
      ) : (
        <Text className="font-body text-sm text-ink-2">{t.prices.noneSource}</Text>
      )}
    </View>
  );
}

function History({ printId }: { printId: string }) {
  const t = useT();
  const locale = useLocale();
  const [days, setDays] = useState<'30' | '90' | '365'>('90');
  const points: PricePoint[] = usePriceHistory(printId, Number(days)) ?? [];
  const first = points[0];
  const last = points.at(-1);
  return (
    <View className="gap-3 border-t border-line pt-4">
      <View className="flex-row flex-wrap items-end justify-between gap-3">
        <Text
          role="heading"
          aria-level={3}
          className="font-display text-[14.5px] font-semibold text-ink"
        >
          {t.prices.history}
        </Text>
        <Segmented
          label={t.prices.range}
          value={days}
          onChange={setDays}
          options={(['30', '90', '365'] as const).map((d) => ({
            value: d,
            label: t.prices.days[d],
          }))}
        />
      </View>
      {first && last && points.length > 1 ? (
        <>
          <PriceLine points={points} />
          <View className="flex-row justify-between">
            <Text className="font-mono text-[12.5px] text-ink-3">
              {formatDate(first.date, locale)} · {money(first.cents, 'EUR', locale)}
            </Text>
            <Text className="font-mono text-[12.5px] text-ink">
              {t.prices.today} · {money(last.cents, 'EUR', locale)}
            </Text>
          </View>
        </>
      ) : (
        <Text className="font-body text-sm text-ink-2">{t.prices.noHistory}</Text>
      )}
    </View>
  );
}

/**
 * The price panel: Cardmarket and TCGplayer side by side with source, finish, condition and
 * time, the condition row (NM observed, EX and GD estimated, marked ≈) and the history line.
 * Without prices (VB-30 not merged, or none for this print) it says so and shows no number.
 */
export function PricePanel({ printId, finishes }: { printId: string; finishes: string[] }) {
  const t = useT();
  const locale = useLocale();
  const prices = usePrintPrices(printId);
  const [finish, setFinish] = useState(finishes[0] ?? 'normal');
  return (
    <Section
      title={t.prices.title}
      aside={
        prices &&
        finishes.length > 1 && (
          <Segmented
            label={t.card.table.finish}
            value={finish}
            onChange={setFinish}
            options={finishes.map((f) => ({ value: f, label: label(t.card.finishes, f) }))}
          />
        )
      }
    >
      {!prices ? (
        <Text className="font-body text-[15px] text-ink-2">{t.prices.none}</Text>
      ) : (
        <>
          <View className="flex-row flex-wrap gap-3">
            <SourceColumn i={0} price={pick(prices, 0, finish)} />
            <SourceColumn i={1} price={pick(prices, 1, finish)} />
          </View>
          {prices.conditions.length > 0 && (
            <View className="gap-2 border-t border-line pt-3">
              <View
                role="group"
                aria-label={t.prices.condition}
                className="flex-row flex-wrap items-center gap-2.5"
              >
                <Text className="font-display text-[11.5px] font-semibold uppercase tracking-wider text-ink-3">
                  {t.prices.condition}
                </Text>
                {prices.conditions.map((c) => (
                  <View
                    key={c.condition}
                    className={`min-w-[120px] flex-1 flex-row items-baseline justify-between gap-2 rounded-xl px-3.5 py-2.5 ${c.condition === 'NM' ? 'border-[1.5px] border-ink' : 'border border-line'}`}
                  >
                    <Text className="font-display text-[13px] font-semibold text-ink">
                      {c.condition}
                    </Text>
                    <Text className="font-mono text-[15px] font-semibold text-ink">
                      {c.condition === 'NM' ? '' : '≈ '}
                      {money(c.cents, prices.currency, locale)}
                    </Text>
                  </View>
                ))}
              </View>
              <Text className="font-body text-[12.5px] text-ink-3">{t.prices.estimates}</Text>
            </View>
          )}
          <History printId={printId} />
        </>
      )}
    </Section>
  );
}

/** The phone's two-price strip above the buttons; a dash while there is no price. */
export function PriceStrip({ printId, finish }: { printId: string; finish: string }) {
  const t = useT();
  const locale = useLocale();
  const prices = usePrintPrices(printId);
  return (
    <View className="flex-row gap-2">
      {([0, 1] as const).map((i) => {
        const p = pick(prices, i, finish);
        return (
          <View
            key={i}
            className="flex-1 flex-row items-baseline justify-between rounded-xl border border-line bg-surface px-3 py-2.5"
          >
            <Text className="font-display text-[13px] font-semibold text-ink-2">
              {SOURCES[i].name}
            </Text>
            <Text
              aria-label={p ? undefined : t.prices.noneSource}
              className="font-mono text-base font-bold text-ink"
            >
              {p ? money(p.market, p.currency, locale) : '–'}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
