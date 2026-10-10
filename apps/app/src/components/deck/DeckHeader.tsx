import { DECK_ZONES, type DeckDetail, type DeckZone } from '@voidbinder/shared/api';
import { Text, View } from 'react-native';
import { useBanlist } from '../../api/queries/catalog';
import { fmt, useLocale, useT } from '../../i18n';
import { CardImage } from '../catalog/CardImage';
import { field, GameChip } from '../catalog/GameChip';
import { day, money, SOURCE_NAMES } from '../collection/format';
import { Icon } from '../Icon';
import { usePalette } from '../palette';
import { useWide } from '../Shell';
import { TextLink } from '../ui';
import { headline, problemText } from './format';

const small = 'font-display text-xs font-semibold uppercase tracking-wider text-ink';

/** The format and, next to it, "turnierlegal" or how many rules the deck breaks. */
export function FormatChip({ format, problems }: { format: string; problems: number }) {
  const t = useT();
  const palette = usePalette();
  return (
    <View className="flex-row items-center gap-2 self-start rounded-full bg-surface py-1 pl-3.5 pr-1">
      <Text className="font-display text-sm font-semibold text-ink">
        {t.decks.formats[format] ?? format}
      </Text>
      <View
        className={`flex-row items-center gap-1 rounded-full px-2.5 py-1 ${problems ? 'bg-surface-2' : 'border border-line'}`}
      >
        {!problems && <Icon name="check" size={14} color={palette.okInk} />}
        <Text
          className={`font-display text-[13px] font-semibold ${problems ? 'text-ink' : 'text-ok-ink'}`}
        >
          {problems ? fmt(t.decks.problemCount, { count: problems }) : t.decks.legal}
        </Text>
      </View>
    </View>
  );
}

/** One rule card: the zone's count against its limits, with a quiet ink bar. */
function ZoneRule({ deck, zone }: { deck: DeckDetail; zone: DeckZone }) {
  const t = useT();
  const wide = useWide();
  const r = t.decks.rules;
  const limit = deck.analysis.rules.zones[zone] ?? {};
  const count = deck.analysis.counts[zone] ?? 0;
  const text =
    limit.min !== undefined && limit.min === limit.max
      ? fmt(r.exactly, { size: limit.min })
      : limit.min !== undefined && limit.max !== undefined
        ? fmt(r.range, { min: limit.min, max: limit.max })
        : limit.max !== undefined
          ? fmt(r.upTo, { max: limit.max })
          : fmt(r.atLeast, { min: limit.min ?? 0 });
  const target = limit.max ?? limit.min ?? 1;
  const ratio = Math.min(1, count / Math.max(1, target));
  return (
    <View className="min-w-[150px] flex-1 gap-2 rounded-xl bg-surface p-4">
      <Text className={small}>{t.decks.zones[zone]}</Text>
      {/* "von 40 bis 60" next to the number, under it on phones where the card is narrow. */}
      <Text className="font-display text-[26px] font-bold leading-7 text-ink">
        {count}
        {wide && <Text className="font-mono text-[13px] font-medium text-ink-2"> {text}</Text>}
      </Text>
      {!wide && <Text className="-mt-1 font-mono text-[13px] font-medium text-ink-2">{text}</Text>}
      <View
        role="progressbar"
        aria-label={t.decks.zones[zone]}
        aria-valuemin={0}
        aria-valuemax={target}
        aria-valuenow={count}
        className="h-1.5 overflow-hidden rounded-full bg-surface-2"
      >
        <View className="h-full rounded-full bg-ink" style={{ width: `${ratio * 100}%` }} />
      </View>
    </View>
  );
}

/** Copies per card and the ban list's state. */
function CopiesRule({ deck }: { deck: DeckDetail }) {
  const t = useT();
  const palette = usePalette();
  const r = t.decks.rules;
  const broken = deck.analysis.problems.filter((p) =>
    ['banned', 'not_legal', 'too_many_copies'].includes(p.code),
  ).length;
  return (
    <View className="min-w-[150px] flex-1 gap-2 rounded-xl bg-surface p-4">
      <Text className={small}>{r.perCard}</Text>
      <Text className="font-display text-[26px] font-bold leading-7 text-ink">
        {deck.analysis.rules.copies}
        <Text className="font-mono text-[13px] font-medium text-ink-2"> {r.most}</Text>
      </Text>
      <View className="flex-row items-center gap-1.5">
        {!broken && <Icon name="check" size={14} color={palette.okInk} />}
        <Text
          className={`font-display text-[13px] font-semibold ${broken ? 'text-ink' : 'text-ok-ink'}`}
        >
          {broken
            ? fmt(r.listBroken, { count: broken })
            : deck.game === 'yugioh'
              ? r.limitListOk
              : r.banlistOk}
        </Text>
      </View>
      {deck.game === 'yugioh' && <ListLine />}
    </View>
  );
}

/** "TCG-Liste gültig ab 01.09.2026", a link to the ban list (VB-81); Yu-Gi-Oh! decks are TCG. */
function ListLine() {
  const t = useT();
  const locale = useLocale();
  const list = useBanlist('tcg', locale).data;
  const b = t.banlist;
  const text = list?.effectiveDate
    ? fmt(b.deckLine, { date: day(list.effectiveDate, locale) })
    : list?.asOf
      ? fmt(b.deckLineAsOf, { date: day(list.asOf, locale) })
      : b.open;
  return (
    <Text className="font-body text-[13px]">
      <TextLink href="/yugioh/banlist">{text}</TextLink>
    </Text>
  );
}

/**
 * The deck's game-tinted header (docs/app/mockups/deck.html): game and format chips with the
 * legality, the name, value and last change, a rule card per zone and per card, and the rules the
 * deck breaks, in the user's language.
 */
export function DeckHeader({ deck }: { deck: DeckDetail }) {
  const t = useT();
  const locale = useLocale();
  const wide = useWide();
  const value = headline(deck.analysis.value.totals);
  // The zones the format counts: Magic's commander zone only in Commander.
  const zones = DECK_ZONES[deck.game].filter((z) => z in deck.analysis.rules.zones);
  const art = [...deck.entries]
    .filter((e) => e.print?.imageUrl)
    .sort((a, b) => (b.price?.unitCents ?? 0) - (a.price?.unitCents ?? 0))
    .slice(0, 3);
  return (
    <View
      className={`overflow-hidden rounded-3xl ${wide ? 'gap-5 p-8' : 'gap-4 p-5'} ${field[deck.game].tint}`}
    >
      <View
        aria-hidden
        className={`absolute -right-20 -top-24 h-[340px] w-[340px] rounded-full opacity-30 ${field[deck.game].dot}`}
      />
      {wide && art.length > 0 && (
        <View aria-hidden className="absolute right-10 top-8 flex-row">
          {art.map((e, i) => (
            <View
              key={e.cardId + e.zone}
              className="-ml-8 w-[120px]"
              style={{ transform: [{ rotate: `${(i - (art.length - 1) / 2) * 7}deg` }] }}
            >
              <CardImage
                uri={e.print?.imageUrl ?? null}
                alt=""
                game={deck.game}
                format={e.print?.cardFormat ?? 'standard'}
                number={e.print?.displayNumber ?? ''}
              />
            </View>
          ))}
        </View>
      )}
      <View className="flex-row flex-wrap gap-2">
        <GameChip game={deck.game} name={t.collection.gameShort[deck.game]} />
        <FormatChip format={deck.format} problems={deck.analysis.problems.length} />
      </View>
      <Text
        role="heading"
        aria-level={1}
        className={`font-display font-extrabold leading-none tracking-tighter text-ink ${wide ? 'max-w-[640px] text-[52px]' : 'text-[34px]'}`}
      >
        {deck.name}
      </Text>
      <Text className="font-body text-[15px] text-ink-2">
        {value
          ? fmt(t.decks.value, {
              amount: money(value.main.cents, value.main.currency, locale),
              source: SOURCE_NAMES[value.main.source],
            })
          : t.decks.noPrice}
        {` · ${fmt(t.decks.changed, { date: day(deck.updatedAt, locale) })}`}
      </Text>
      <View
        role="list"
        aria-label={t.decks.rules.label}
        className={`flex-row flex-wrap gap-3 ${wide ? 'max-w-[760px]' : ''}`}
      >
        {zones.map((zone) => (
          <View key={zone} role="listitem" className="min-w-[150px] flex-1">
            <ZoneRule deck={deck} zone={zone} />
          </View>
        ))}
        <View role="listitem" className="min-w-[150px] flex-1">
          <CopiesRule deck={deck} />
        </View>
      </View>
      {deck.analysis.problems.length > 0 && (
        <View className="gap-1.5 rounded-xl bg-surface p-4">
          <Text className={small}>{t.decks.problemsTitle}</Text>
          <View role="list" className="gap-1">
            {deck.analysis.problems.map((p, i) => (
              <Text key={i} role="listitem" className="font-body text-sm leading-5 text-ink">
                {problemText(t, p, deck.game)}
              </Text>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}
