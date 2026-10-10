import type { SearchHit } from '@voidbinder/shared/api';
import { cardAspect } from '@voidbinder/shared';
import { Link } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { useT } from '../../i18n';
import { BanBadge, useBanLabel, useBanStatus } from '../banlist/BanBadge';
import { Price } from '../catalog/Cards';
import { priceTag } from '../catalog/seams';
import { CardImage } from './CardImage';
import { numberLabel } from './game';

/**
 * A search result: image, name, set code and number in mono, set name, market price. Opens the
 * card page. `lang`: the language the hit is shown in (its price says when it is another's).
 */
export function PrintTile({ hit, lang }: { hit: SearchHit; lang: string }) {
  const t = useT();
  const set = hit.setCode.toUpperCase();
  const code = `${set} ${hit.displayNumber}`;
  // VB-81: the TCG ban list status of a Yu-Gi-Oh! hit.
  const ban = useBanStatus(hit.game, hit.cardId);
  const banLabel = useBanLabel();
  return (
    <Link href={`/cards/${hit.cardId}?print=${hit.id}`} asChild>
      <Pressable
        aria-label={`${hit.name}, ${set} ${numberLabel(t.card.numberIn, hit)}${ban ? `, ${banLabel(ban)}` : ''}`}
        className="gap-2 rounded-xl"
      >
        <View>
          <CardImage uri={hit.imageUrl} format={hit.cardFormat} />
          {ban && (
            <View className="absolute left-1.5 top-1.5">
              <BanBadge status={ban} />
            </View>
          )}
        </View>
        <View className="gap-0.5 px-0.5">
          <Text
            numberOfLines={2}
            className="font-display text-[13.5px] font-semibold leading-tight text-ink"
          >
            {hit.name}
          </Text>
          <Text numberOfLines={1} className="font-mono text-xs text-ink-2">
            {code}
          </Text>
          <Text numberOfLines={1} className="font-body text-xs text-ink-3">
            {hit.setName}
          </Text>
          <Price price={priceTag(hit.marketPrice, lang)} />
        </View>
      </Pressable>
    </Link>
  );
}

/** The grey tiles while a search loads. */
export function TileSkeleton() {
  return (
    <View aria-hidden className="gap-2">
      <View style={{ aspectRatio: cardAspect() }} className="w-full rounded-lg bg-surface-2" />
      <View className="h-3.5 w-4/5 rounded bg-surface-2" />
      <View className="h-3 w-1/2 rounded bg-surface-2" />
    </View>
  );
}
