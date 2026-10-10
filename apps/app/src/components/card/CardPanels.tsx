import type { Game } from '@voidbinder/shared';
import type { CardPrint, PrintDetail } from '@voidbinder/shared/api';
import { Link } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { fmt, useT } from '../../i18n';
import { Price } from '../catalog/Cards';
import { priceTag } from '../catalog/seams';
import { label } from './attributes';
import { fieldClass } from './game';
import { Section } from './PricePanel';

/** The prints table; on a phone Nr. and languages fold into the set cell. */
export function PrintsTable({
  prints,
  current,
  cardId,
  game,
  wide,
}: {
  prints: CardPrint[];
  current: string;
  cardId: string;
  game: Game;
  wide: boolean;
}) {
  const t = useT();
  const [all, setAll] = useState(false);
  // ponytail: the first 12 rows, then all on request (basic lands have hundreds of prints).
  const shown = all ? prints : prints.slice(0, 12);
  const h = t.card.table;
  const head = 'font-display text-[11.5px] font-semibold uppercase tracking-wider text-ink-3';
  const cell = 'font-body text-sm text-ink';
  const cols = wide
    ? ([
        ['flex-[2.4]', h.set],
        ['flex-[0.8]', h.number],
        ['flex-[0.8]', h.languages],
        ['flex-[1.2]', h.finish],
        ['flex-1', h.rarity],
        ['flex-[0.8] text-right', h.price],
      ] as const)
    : ([
        ['flex-[2.4]', h.set],
        ['flex-[1.2]', h.finish],
        ['flex-[0.8] text-right', h.price],
      ] as const);
  return (
    <Section title={t.card.printsTitle}>
      <View role="table" aria-label={t.card.printsTitle}>
        <View role="row" className="flex-row gap-3 border-b border-line px-2.5 pb-3">
          {cols.map(([w, name]) => (
            <Text key={name} role="columnheader" className={`${w} ${head}`}>
              {name}
            </Text>
          ))}
        </View>
        {shown.map((p) => {
          const on = p.id === current;
          const langs = p.localizations.map((l) => l.lang.toUpperCase()).join(' · ');
          const finishes = p.finishes.map((f) => label(t.card.finishes, f)).join(', ');
          const rarity = p.rarity ? label(t.card.rarities, p.rarity) : '';
          return (
            <View
              key={p.id}
              role="row"
              aria-current={on ? 'true' : undefined}
              className={`flex-row items-center gap-3 border-b border-line px-2.5 py-2.5 ${on ? `${fieldClass[game].soft} border-l-[3px] ${fieldClass[game].edge}` : ''}`}
            >
              <View role="cell" className="flex-[2.4] gap-0.5">
                <Link
                  href={`/cards/${cardId}?print=${p.id}`}
                  className="font-display text-[14.5px] font-semibold text-ink underline"
                >
                  {p.set.name}
                </Link>
                <Text className="font-mono text-xs text-ink-2">
                  {wide ? p.set.code.toUpperCase() : `${p.set.code.toUpperCase()} ${p.number}`}
                  {!wide && langs ? ` · ${langs}` : ''}
                  {!wide && rarity ? ` · ${rarity}` : ''}
                </Text>
              </View>
              {wide && (
                <>
                  <Text role="cell" className={`flex-[0.8] font-mono text-sm text-ink`}>
                    {p.number}
                  </Text>
                  <Text role="cell" className={`flex-[0.8] ${cell}`}>
                    {langs}
                  </Text>
                </>
              )}
              <Text role="cell" className={`flex-[1.2] ${cell}`}>
                {finishes}
              </Text>
              {wide && (
                <Text role="cell" className={`flex-1 ${cell}`}>
                  {rarity}
                </Text>
              )}
              <View role="cell" className="flex-[0.8] items-end">
                {p.marketPrice ? (
                  <Price price={priceTag(p.marketPrice)} />
                ) : (
                  <Text aria-label={t.prices.noneSource} className="font-mono text-sm text-ink-2">
                    –
                  </Text>
                )}
              </View>
            </View>
          );
        })}
      </View>
      {prints.length > shown.length && (
        <Pressable role="button" onPress={() => setAll(true)} className="self-start py-1">
          <Text className="font-body text-sm font-semibold text-blue-ink underline">
            {fmt(t.card.allPrints, { count: prints.length })}
          </Text>
        </Pressable>
      )}
    </Section>
  );
}

// Format names are proper names, the same in both languages, in the mockup's order.
const FORMATS: Partial<Record<Game, [string, string][]>> = {
  mtg: [
    ['standard', 'Standard'],
    ['pioneer', 'Pioneer'],
    ['modern', 'Modern'],
    ['legacy', 'Legacy'],
    ['vintage', 'Vintage'],
    ['commander', 'Commander'],
    ['pauper', 'Pauper'],
    ['brawl', 'Brawl'],
  ],
  pokemon: [
    ['standard', 'Standard'],
    ['expanded', 'Expanded'],
  ],
  // The ban lists (VB-81); GOAT is a fan format and stays out.
  yugioh: [
    ['tcg', 'TCG'],
    ['ocg', 'OCG'],
  ],
};

const STATUS: Record<string, string> = {
  legal: 'border border-line bg-surface text-ok-ink',
  banned: 'bg-ink text-page',
  Forbidden: 'bg-ink text-page',
  Unlimited: 'border border-line bg-surface text-ok-ink',
};

/** Legality chips for Magic, Pokémon and the Yu-Gi-Oh! lists, where the source has data. */
export function Legality({
  game,
  legalities,
  className,
}: {
  game: Game;
  legalities: Record<string, string>;
  className?: string | undefined;
}) {
  const t = useT();
  const rows = (FORMATS[game] ?? []).filter(([key]) => legalities[key]);
  if (!rows.length) return null;
  return (
    <Section title={t.card.legality} className={className}>
      <View className="flex-row flex-wrap gap-2">
        {rows.map(([key, name]) => {
          const status = legalities[key] ?? '';
          return (
            <View
              key={key}
              className="min-w-[140px] flex-1 basis-[45%] flex-row items-center justify-between rounded-[10px] bg-page py-2 pl-3 pr-2.5"
            >
              <Text className="font-display text-[13.5px] font-semibold text-ink">{name}</Text>
              <Text
                className={`rounded-[7px] px-2 py-1 font-display text-xs font-semibold ${STATUS[status] ?? 'bg-surface-2 text-ink-2'}`}
              >
                {label(t.card.legal, status)}
              </Text>
            </View>
          );
        })}
      </View>
    </Section>
  );
}

/** The card text in the shown language, then artist, set and number. */
export function CardText({
  text,
  lang,
  print,
  className,
}: {
  text: string | null;
  lang: string;
  print: PrintDetail | undefined;
  className?: string | undefined;
}) {
  const t = useT();
  const meta: [string, string | null | undefined][] = [
    [t.card.meta.artist, print?.artist],
    [t.card.meta.set, print && `${print.set.name} (${print.set.code.toUpperCase()})`],
    [t.card.meta.number, print?.number],
  ];
  return (
    <Section
      title={t.card.text}
      className={className}
      aside={
        <Text className="font-body text-[12.5px] text-ink-3">{label(t.card.languages, lang)}</Text>
      }
    >
      <Text lang={lang} className="font-body text-[14.5px] leading-6 text-ink">
        {text ?? t.card.noText}
      </Text>
      <View className="gap-1.5 border-t border-line pt-3">
        {meta
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <View key={k} className="flex-row gap-4">
              <Text className="w-24 font-body text-[13.5px] text-ink-3">{k}</Text>
              <Text className="flex-1 font-body text-[13.5px] text-ink">{v}</Text>
            </View>
          ))}
      </View>
    </Section>
  );
}
