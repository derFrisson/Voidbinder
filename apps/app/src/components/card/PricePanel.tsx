import type { Locale } from '@voidbinder/shared';
import { useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import {
  SOURCE_NAME,
  usePriceHistory,
  usePrintPrices,
  type Price,
  type PrintPricesResponse,
} from '../../api/queries/cards';
import { fmt, useLocale, useT } from '../../i18n';
import { ErrorState, Segmented } from '../ui';
import { formatDate, label } from './attributes';
import { PriceLang } from './PriceLang';
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

// `tcgplayer` (TCGCSV, with a low price) before `tcgplayer_scryfall`: the API lists them alphabetically.
const pick = (prices: PrintPricesResponse | null, i: 0 | 1, finish: string) =>
  SOURCES[i].match
    .map((source) => prices?.prices.find((p) => p.source === source && p.finish === finish))
    .find(Boolean);

const hasSource = (prices: PrintPricesResponse | null, i: 0 | 1) =>
  !!prices?.prices.some((p) => (SOURCES[i].match as readonly string[]).includes(p.source));

/**
 * The finishes to choose from: the print's own, then any the price rows are filed under that the
 * print does not list (Yu-Gi-Oh!: TCGplayer prices per edition, `first_edition`, while the print
 * says `normal`).
 */
const finishOptions = (finishes: readonly string[], prices: PrintPricesResponse | null) => [
  ...new Set([...finishes, ...(prices?.prices.map((p) => p.finish) ?? [])]),
];

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

function SourceColumn({ i, price, lang }: { i: 0 | 1; price: Price | undefined; lang: string }) {
  const t = useT();
  const locale = useLocale();
  return (
    <View className="min-w-[220px] flex-1 gap-3 rounded-2xl bg-surface-2 p-4">
      <View className="flex-row items-baseline justify-between">
        <Text className="font-display text-sm font-semibold text-ink">{SOURCES[i].name}</Text>
        <Text className="font-mono text-xs text-ink-3">
          {price?.currency ?? (i === 0 ? 'EUR' : 'USD')}
        </Text>
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
            <PriceLang lang={price.lang} shown={lang} />
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
            {/* The line may only break after a separator, and keeps "Stand date, time" together
                (no-break spaces; they read as spaces to the tests and to screen readers). */}
            {[price.sourceLabel, label(t.card.finishes, price.finish), t.prices.nearMint].join(
              ' · ',
            )}
            {'\u00a0· '}
            {fmt(t.prices.asOf, { date: dateTime(price.observedAt, locale) }).replaceAll(
              ' ',
              '\u00a0',
            )}
          </Text>
        </>
      ) : (
        <Text className="font-body text-sm text-ink-2">{t.prices.noneSource}</Text>
      )}
    </View>
  );
}

function History({ printId, finish, lang }: { printId: string; finish: string; lang: string }) {
  const t = useT();
  const locale = useLocale();
  const [days, setDays] = useState<'30' | '90' | '365'>('90');
  const series = usePriceHistory(printId, Number(days), finish, lang);
  const points = series?.points ?? [];
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
          {series && (
            <Text className="font-normal text-ink-3"> · {SOURCE_NAME[series.source]}</Text>
          )}
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
      {series && first && last && points.length > 1 ? (
        <>
          <PriceLine points={points} />
          <View className="flex-row justify-between">
            <Text className="font-mono text-[12.5px] text-ink-3">
              {formatDate(first.date, locale)} · {money(first.cents, series.currency, locale)}
            </Text>
            <Text className="font-mono text-[12.5px] text-ink">
              {formatDate(last.date, locale)} · {money(last.cents, series.currency, locale)}
            </Text>
          </View>
        </>
      ) : (
        <Text className="font-body text-sm text-ink-2">{t.prices.noHistory}</Text>
      )}
    </View>
  );
}

// NM, EX and GD on the mockup's row; the lower grades come with "more".
const MAIN_CONDITIONS = ['NM', 'EX', 'GD'];

/**
 * The price panel: Cardmarket and TCGplayer side by side with source, finish, condition and
 * time, the condition row (NM observed, the others estimated, marked ≈) and the history line.
 * The finish starts at the display price's and offers the print's finishes and the ones its
 * prices are filed under. Without prices it says so and shows no number; a failed read says so
 * and offers a retry.
 */
export function PricePanel({
  printId,
  finishes,
  lang,
}: {
  printId: string;
  finishes: string[];
  /** The language of the card shown: prices in it first, a chip on one that is another's. */
  lang: string;
}) {
  const t = useT();
  const locale = useLocale();
  const [picked, setPicked] = useState<string>();
  const [more, setMore] = useState(false);
  const { prices, failed, retry } = usePrintPrices(printId, lang, picked);
  const display = prices?.display;
  const finish = picked ?? display?.finish ?? finishes[0] ?? 'normal';
  const options = finishOptions(finishes, prices);
  // The estimates belong to the display price's finish: not shown for a finish without a price.
  const all = display?.finish === finish ? (prices?.conditions ?? []) : [];
  const conditions = more ? all : all.filter((c) => MAIN_CONDITIONS.includes(c.condition));
  const estimated = conditions.filter((c) => c.factor !== 1).map((c) => c.condition);
  return (
    <Section
      title={t.prices.title}
      aside={
        prices &&
        options.length > 1 && (
          <Segmented
            label={t.card.table.finish}
            value={finish}
            onChange={setPicked}
            options={options.map((f) => ({ value: f, label: label(t.card.finishes, f) }))}
          />
        )
      }
    >
      {!prices ? (
        failed ? (
          <ErrorState onRetry={retry} />
        ) : (
          <Text className="font-body text-[15px] text-ink-2">{t.prices.none}</Text>
        )
      ) : (
        <>
          <View className="flex-row flex-wrap gap-3">
            {([0, 1] as const).map(
              (i) =>
                hasSource(prices, i) && (
                  <SourceColumn key={i} i={i} price={pick(prices, i, finish)} lang={lang} />
                ),
            )}
          </View>
          {display && conditions.length > 0 && (
            <View className="gap-2 border-t border-line pt-3">
              <View
                role="group"
                aria-label={t.prices.condition}
                className="flex-row flex-wrap items-center gap-2.5"
              >
                <Text className="font-display text-[11.5px] font-semibold uppercase tracking-wider text-ink-3">
                  {t.prices.condition}
                </Text>
                {conditions.map((c) => (
                  <View
                    key={c.condition}
                    className={`min-w-[120px] flex-1 flex-row items-baseline justify-between gap-2 rounded-xl px-3.5 py-2.5 ${c.factor === 1 ? 'border-[1.5px] border-ink' : 'border border-line'}`}
                  >
                    <Text className="font-display text-[13px] font-semibold text-ink">
                      {c.condition}
                    </Text>
                    <Text className="font-mono text-[15px] font-semibold text-ink">
                      {c.factor === 1 ? '' : '≈ '}
                      {money(c.cents, display.currency, locale)}
                    </Text>
                  </View>
                ))}
              </View>
              {all.length > conditions.length || more ? (
                <Pressable
                  role="button"
                  aria-expanded={more}
                  onPress={() => setMore(!more)}
                  className="self-start py-1"
                >
                  <Text className="font-body text-sm font-semibold text-blue-ink underline">
                    {more ? t.prices.lessConditions : t.prices.moreConditions}
                  </Text>
                </Pressable>
              ) : null}
              {estimated.length > 0 && (
                <Text className="font-body text-[12.5px] text-ink-3">
                  {fmt(t.prices.estimates, {
                    grades: new Intl.ListFormat(locale).format(estimated),
                    basis: `${SOURCE_NAME[display.source]}, ${label(t.card.finishes, display.finish)}`,
                  })}
                </Text>
              )}
            </View>
          )}
          <History printId={printId} finish={finish} lang={lang} />
        </>
      )}
    </Section>
  );
}

/**
 * The phone's price strip above the buttons, of the display price's finish: both sources, or the
 * one that has rows; dashes while there is no price.
 */
export function PriceStrip({ printId, lang }: { printId: string; lang: string }) {
  const t = useT();
  const locale = useLocale();
  const { prices } = usePrintPrices(printId, lang);
  const finish = prices?.display?.finish ?? '';
  return (
    <View className="flex-row gap-2">
      {([0, 1] as const).map((i) => {
        // A source without a row for any finish is left out while the other has some.
        if (prices && !hasSource(prices, i)) return null;
        const p = pick(prices, i, finish);
        return (
          <View
            key={i}
            className="flex-1 flex-row items-baseline justify-between rounded-xl border border-line bg-surface px-3 py-2.5"
          >
            <Text className="font-display text-[13px] font-semibold text-ink-2">
              {SOURCES[i].name}
            </Text>
            <View className="flex-row items-baseline gap-1.5">
              <PriceLang lang={p?.lang} shown={lang} />
              <Text
                aria-label={p ? undefined : t.prices.noneSource}
                className="font-mono text-base font-bold text-ink"
              >
                {p ? money(p.market, p.currency, locale) : '–'}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}
