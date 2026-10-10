import type { Game } from '@voidbinder/shared';
import type { PrintSummary } from '@voidbinder/shared/api';
import { Link } from 'expo-router';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';
import { fmt, useLocale, useT } from '../../i18n';
import { BanBadge, useBanLabel, useBanStatus } from '../banlist/BanBadge';
import { QuickAdd } from '../collection/CollectButtons';
import { numberLabel } from '../card/game';
import { CardImage } from './CardImage';
import { formatDate, type OwnedPrint } from './model';
import { PriceLang } from '../card/PriceLang';
import { formatPrice, type PriceTag } from './seams';

/**
 * Columns of the dense grid: 8 from 1760 px (the catalog width, VB-100), 7 from 1240, 5 from 1024,
 * 4 from 768, 3 on phones. A tile is never narrower than at 7 columns in a 1240 px window.
 */
export function useColumns() {
  const { width } = useWindowDimensions();
  return width >= 1760 ? 8 : width >= 1240 ? 7 : width >= 1024 ? 5 : width >= 768 ? 4 : 3;
}

export function useRarityLabel() {
  const t = useT();
  const names: Record<string, string> = t.set.rarities;
  return (rarity: string | null) => (rarity ? (names[rarity] ?? rarity) : '');
}

export function useFinishLabel() {
  const t = useT();
  const names: Record<string, string> = t.set.finishes;
  return (finish: string) => names[finish] ?? finish;
}

interface Item {
  print: PrintSummary;
  game: Game;
  /** Upper-case set code, part of the alt text and the link's name. */
  setCode: string;
  /** Present when the user's collection is known: absent copies show greyed as missing. */
  owned: OwnedPrint | undefined;
  signedIn: boolean;
  price: PriceTag | undefined;
}

/**
 * The price with its source and, when known, the day of the quote, and the language chip when it
 * is for copies in another language; nothing without a price.
 */
export function Price({ price }: { price: PriceTag | undefined }) {
  const t = useT();
  const locale = useLocale();
  if (!price) return null;
  return (
    <View className="gap-0.5">
      <View className="flex-row items-center gap-1.5">
        <Text className="font-mono text-[13px] font-medium text-ink">
          {formatPrice(price, locale)}
        </Text>
        {price.shown && <PriceLang lang={price.lang} shown={price.shown} />}
      </View>
      <Text className="font-body text-[11px] text-ink-3">
        {price.asOf
          ? fmt(t.set.valueAsOf, { source: price.source, date: formatDate(price.asOf, locale) })
          : price.source}
      </Text>
    </View>
  );
}

/** One card of the dense grid: picture, owned badge or "fehlt", number, rarity, name, price. */
export function CardTile({ print, game, setCode, owned, signedIn, price }: Item) {
  const t = useT();
  const rarity = useRarityLabel();
  const ban = useBanStatus(game, print.cardId);
  const banLabel = useBanLabel();
  const missing = signedIn && !owned?.count;
  const name = `${print.name}, ${setCode} ${numberLabel(t.card.numberIn, print)}`;
  return (
    <Link href={`/cards/${print.cardId}`} asChild>
      <Pressable aria-label={ban ? `${name}, ${banLabel(ban)}` : name} className="gap-2 rounded-lg">
        <View>
          <CardImage
            uri={print.imageUrl}
            alt={name}
            game={game}
            format={print.cardFormat}
            number={print.displayNumber}
            className={missing ? 'border-dashed opacity-50' : ''}
          />
          {ban && (
            <View className="absolute left-1.5 top-1.5">
              <BanBadge status={ban} />
            </View>
          )}
          {signedIn && owned?.count ? (
            <View className="absolute right-1.5 top-1.5 rounded-md bg-surface px-1.5 py-0.5">
              <Text className="font-display text-xs font-bold text-ink">{owned.count}×</Text>
            </View>
          ) : null}
          {missing && (
            <View className="absolute inset-x-0 bottom-3 items-center">
              <Text className="rounded-full bg-surface px-2.5 py-0.5 font-display text-xs font-semibold text-ink-2">
                {t.set.missing}
              </Text>
            </View>
          )}
        </View>
        <View className="gap-0.5">
          <View className="flex-row items-baseline justify-between gap-2">
            <Text className="font-mono text-[11.5px] text-ink-2">{print.displayNumber}</Text>
            <Text numberOfLines={1} className="shrink font-body text-[11.5px] text-ink-3">
              {rarity(print.rarity)}
            </Text>
          </View>
          <Text numberOfLines={2} className="font-display text-[13px] font-semibold text-ink">
            {print.name}
          </Text>
          <Price price={price} />
        </View>
      </Pressable>
    </Link>
  );
}

/** One row of the list view: small picture, number, name, rarity, finishes (with copies owned), price. */
export function CardRow({ print, game, setCode, owned, signedIn, price }: Item) {
  const t = useT();
  const rarity = useRarityLabel();
  const finish = useFinishLabel();
  const ban = useBanStatus(game, print.cardId);
  const banLabel = useBanLabel();
  const missing = signedIn && !owned?.count;
  const name = `${print.name}, ${setCode} ${numberLabel(t.card.numberIn, print)}${ban ? `, ${banLabel(ban)}` : ''}`;
  const finishes = print.finishes
    .map((f) => (owned?.byFinish[f] ? `${finish(f)} ${owned.byFinish[f]}×` : finish(f)))
    .join(' · ');
  return (
    <View role="listitem">
      <Link href={`/cards/${print.cardId}`} asChild>
        <Pressable
          aria-label={name}
          className="min-h-[64px] flex-row items-center gap-3 border-b border-line py-2"
        >
          <View className="w-10">
            <CardImage
              uri={print.imageUrl}
              alt={name}
              game={game}
              format={print.cardFormat}
              number=""
              className={missing ? 'border-dashed opacity-50' : ''}
            />
          </View>
          <Text className="w-14 font-mono text-[13px] text-ink-2">{print.displayNumber}</Text>
          <View className="flex-1 gap-0.5">
            <View className="flex-row items-center gap-2">
              <Text
                numberOfLines={1}
                className="shrink font-display text-[15px] font-semibold text-ink"
              >
                {print.name}
              </Text>
              {ban && <BanBadge status={ban} />}
            </View>
            <Text numberOfLines={1} className="font-body text-[13px] text-ink-3">
              {[rarity(print.rarity), finishes].filter(Boolean).join(' · ')}
            </Text>
          </View>
          {signedIn && (
            <Text className="font-display text-[13px] font-semibold text-ink-2">
              {missing ? t.set.missing : `${owned?.count ?? 0}×`}
            </Text>
          )}
          <Price price={price} />
        </Pressable>
      </Link>
    </View>
  );
}

/** The grid (flex rows, columns by width) or the list. */
export function CardCollection({
  prints,
  view,
  game,
  setCode,
  owned,
  prices,
}: {
  prints: PrintSummary[];
  view: 'grid' | 'list';
  game: Game;
  setCode: string;
  /** The user's copies per print id; undefined while signed out. */
  owned: ReadonlyMap<string, OwnedPrint> | undefined;
  prices: ReadonlyMap<string, PriceTag> | undefined;
}) {
  const t = useT();
  const columns = useColumns();
  const item = (print: PrintSummary): Item => ({
    print,
    game,
    setCode,
    owned: owned?.get(print.id),
    signedIn: owned !== undefined,
    price: prices?.get(print.id),
  });
  if (view === 'list') {
    return (
      <View role="list">
        {prints.map((p) => (
          <CardRow key={p.id} {...item(p)} />
        ))}
      </View>
    );
  }
  return (
    // Negative margin and padding make the gutters without a gap property on a wrapping row.
    <View role="list" className="-mx-1.5 flex-row flex-wrap">
      {prints.map((p) => (
        <View
          key={p.id}
          role="listitem"
          style={{ width: `${100 / columns}%` }}
          className="gap-2 p-1.5"
        >
          <CardTile {...item(p)} />
          {/* VB-80: signed in, a tile adds straight to the collection, as in the search. */}
          {owned && (
            <QuickAdd
              printId={p.id}
              cardId={p.cardId}
              name={`${p.name}, ${setCode} ${numberLabel(t.card.numberIn, p)}`}
              finish={p.finishes[0] ?? 'normal'}
            />
          )}
        </View>
      ))}
    </View>
  );
}
