import type { Game } from '@voidbinder/shared';
import type { PrintDetail } from '@voidbinder/shared/api';
import { NOTICES, SCRYFALL_ATTRIBUTION } from '@voidbinder/shared/notices';
import { Pressable, Text, View } from 'react-native';
import Svg, { Circle, Defs, Pattern, Rect } from 'react-native-svg';
import { fmt, useLocale, useT } from '../../i18n';
import { usePalette } from '../palette';
import { CardImage } from './CardImage';
import { fieldClass, fieldColor } from './game';

/** The game's colour as a dotted circle, partly off the stage (the mockup's `.field`). */
function FieldShape({ game }: { game: Game }) {
  const palette = usePalette();
  return (
    <View aria-hidden className="absolute -right-[14%] -top-[10%] aspect-square w-[74%]">
      <Svg width="100%" height="100%" viewBox="0 0 100 100">
        <Defs>
          <Pattern id="stage-dots" width={4} height={4} patternUnits="userSpaceOnUse">
            <Circle cx={2} cy={2} r={0.4} fill="#fff" fillOpacity={0.3} />
          </Pattern>
        </Defs>
        <Circle cx={50} cy={50} r={50} fill={fieldColor(game, palette)} />
        <Rect width={100} height={100} fill="url(#stage-dots)" />
      </Svg>
    </View>
  );
}

/**
 * The selected print's image on the game's tinted field; `note` is the quiet line under it when the
 * image is in another language or of another print (VB-86/VB-87).
 */
export function CardStage({
  game,
  uri,
  label,
  wide,
  note,
}: {
  game: Game;
  uri: string | null;
  label: string;
  wide: boolean;
  note?: string | null;
}) {
  return (
    <View
      className={`relative overflow-hidden ${fieldClass[game].soft} ${wide ? 'rounded-[28px] px-[54px] pb-10 pt-11' : 'rounded-[22px] px-[22%] py-5'}`}
    >
      <FieldShape game={game} />
      <View className="-rotate-2 rounded-lg shadow-lg">
        <CardImage uri={uri} label={label} />
      </View>
      {note && (
        <Text className="mt-3 text-center font-body text-[12.5px] leading-5 text-ink-3">
          {note}
        </Text>
      )}
    </View>
  );
}

/** Thumbnails of the card's other prints with an image; pressing one shows it. */
export function PrintThumbs({
  prints,
  current,
  onPick,
}: {
  prints: PrintDetail[];
  current: string;
  onPick: (id: string) => void;
}) {
  const t = useT();
  const seen = new Set<string>();
  const shown = prints
    .filter((p) => p.imageUrl && !seen.has(p.imageUrl) && seen.add(p.imageUrl))
    .slice(0, 7);
  if (shown.length < 2) return null;
  return (
    <View
      role="group"
      aria-label={t.card.views}
      className="flex-row flex-wrap justify-center gap-2"
    >
      {shown.map((p) => (
        <Pressable
          key={p.id}
          role="button"
          aria-pressed={p.id === current}
          aria-label={`${p.set.name} ${p.number}`}
          onPress={() => onPick(p.id)}
          className={`w-12 rounded-[10px] p-1 ${p.id === current ? 'border-2 border-blue' : 'border-2 border-transparent'}`}
        >
          <CardImage uri={p.imageUrl} className="rounded" />
        </Pressable>
      ))}
    </View>
  );
}

/**
 * The game's rights notice (@voidbinder/shared/notices) with the print's artist and the game's
 * copyright line, plus Scryfall's attribution for Magic. Wizards' notice is English in both locales.
 */
export function RightsNotice({
  game,
  artist,
  copyright,
}: {
  game: Game;
  artist: string | null | undefined;
  copyright: string;
}) {
  const t = useT();
  const locale = useLocale();
  const text = 'font-body text-[12.5px] leading-5 text-ink-3';
  return (
    <View className="gap-1 rounded-2xl border border-line bg-surface px-4 py-3.5">
      <Text lang={game === 'mtg' ? 'en' : locale} className={text}>
        {NOTICES[game][locale]}
      </Text>
      <Text className={text}>
        {[artist && fmt(t.card.artist, { artist }), copyright].filter(Boolean).join(' · ')}
      </Text>
      {game === 'mtg' && <Text className={text}>{SCRYFALL_ATTRIBUTION[locale]}</Text>}
    </View>
  );
}
