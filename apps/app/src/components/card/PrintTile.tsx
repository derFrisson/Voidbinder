import type { SearchHit } from '@voidbinder/shared/api';
import { Link } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { CardImage } from './CardImage';

/** A search result: image, name, set code and number in mono, set name. Opens the card page. */
export function PrintTile({ hit }: { hit: SearchHit }) {
  const code = `${hit.setCode.toUpperCase()} ${hit.number}`;
  return (
    <Link href={`/cards/${hit.cardId}?print=${hit.id}`} asChild>
      <Pressable aria-label={`${hit.name}, ${code}`} className="gap-2 rounded-xl">
        <CardImage uri={hit.imageUrl} />
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
        </View>
      </Pressable>
    </Link>
  );
}

/** The grey tiles while a search loads. */
export function TileSkeleton() {
  return (
    <View aria-hidden className="gap-2">
      <View className="aspect-[63/88] w-full rounded-lg bg-surface-2" />
      <View className="h-3.5 w-4/5 rounded bg-surface-2" />
      <View className="h-3 w-1/2 rounded bg-surface-2" />
    </View>
  );
}
