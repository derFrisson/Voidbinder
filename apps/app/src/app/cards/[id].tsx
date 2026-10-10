import type { Game } from '@voidbinder/shared';
import type { CardResponse } from '@voidbinder/shared/api';
import { router, useLocalSearchParams } from 'expo-router';
import { Text, View, useWindowDimensions } from 'react-native';
import { useCard } from '../../api/queries/catalog';
import { CardBanBadges } from '../../components/banlist/BanBadge';
import { attributeChips } from '../../components/card/attributes';
import { CardText, Legality, PrintsTable } from '../../components/card/CardPanels';
import { CardStage, PrintThumbs, RightsNotice } from '../../components/card/CardStage';
import { fieldClass, inLanguage } from '../../components/card/game';
import { CollectButtons } from '../../components/collection/CollectButtons';
import { PricePanel, PriceStrip } from '../../components/card/PricePanel';
import { Page, useWide, type Crumb } from '../../components/Shell';
import { QueryState } from '../../components/ui';
import { fmt, useLocale, useT } from '../../i18n';

/** What the page shows of a card: the selected print and the names and text in the user's language. */
function useView(data: CardResponse | undefined, printId: string | undefined) {
  const locale = useLocale();
  if (!data) return undefined;
  const { prints } = data;
  // The print from the URL, else the newest one with an image of its own.
  const print =
    prints.find((p) => p.id === printId) ??
    prints.find((p) => p.imageUrl && p.imageFrom !== 'sibling') ??
    prints[0];
  const own = print?.localizations.find((l) => l.lang === locale);
  const shown = own?.imageUrl ? own : print;
  const any = prints.flatMap((p) => p.localizations).filter((l) => l.lang === locale);
  const withText = own?.text ? own : any.find((l) => l.text);
  return {
    print,
    name: own?.name ?? any[0]?.name ?? data.card.name,
    text: withText?.text ?? data.card.text,
    textLang: withText ? locale : 'en',
    image: shown?.imageUrl ?? null,
    imageLang: shown?.imageUrl ? shown.imageLang : undefined,
    imageFrom: shown?.imageUrl ? shown.imageFrom : undefined,
  };
}

function CardView({ data, printId }: { data: CardResponse; printId: string | undefined }) {
  const t = useT();
  const locale = useLocale();
  const wide = useWide();
  const width = useWindowDimensions().width;
  const view = useView(data, printId);
  if (!view) return null;
  const { card } = data;
  const { print } = view;
  const game: Game = card.game;
  // Three zones from 1600 px (stage, prices, prints with legality and text), two columns from 768
  // with legality and text side by side from 1180, one column on phones (VB-100).
  const three = width >= 1600;
  const half = width >= 1180 && !three ? 'min-w-0 flex-1' : '';
  const pick = (id: string) => router.setParams({ print: id });

  const header = (
    // In the middle zone (three zones) the buttons go under the title, side by side.
    <View className={half ? 'flex-row items-start justify-between gap-6' : 'gap-4'}>
      <View className="flex-1 gap-3">
        <View className="flex-row flex-wrap items-center gap-2.5">
          <View className="h-7 flex-row items-center gap-2 rounded-full bg-surface px-3">
            <View className={`h-2.5 w-2.5 rounded-[3px] ${fieldClass[game].solid}`} />
            <Text className="font-display text-[13px] font-semibold text-ink">{t.games[game]}</Text>
          </View>
          {print && (
            <Text className="font-display text-[13px] font-semibold text-ink-2">
              {print.set.name} ·{' '}
              <Text className="font-mono">{inLanguage(print, locale).displayCode}</Text>
            </Text>
          )}
        </View>
        <Text
          {...(wide && { role: 'heading' as const, 'aria-level': 1 })}
          className={`font-display font-bold tracking-tighter text-ink ${wide ? 'text-[46px] leading-[48px]' : 'text-[32px] leading-9'}`}
        >
          {view.name}
        </Text>
        {game === 'yugioh' && <CardBanBadges legalities={card.legalities} />}
        {card.typeLine && <Text className="font-body text-[17px] text-ink-2">{card.typeLine}</Text>}
        {wide && (
          <View className="flex-row flex-wrap gap-2">
            {attributeChips(card, print, t, locale).map((c) => (
              <View
                key={c.label}
                className="h-7 flex-row items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5"
              >
                <Text className="font-body text-[13px] text-ink-2">{c.label}</Text>
                <Text className="font-mono text-[13px] font-semibold text-ink">{c.value}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
      {!wide && print && <PriceStrip printId={print.id} />}
      {print && <CollectButtons wide={wide && !three} printId={print.id} cardId={card.id} />}
    </View>
  );

  // What the image is when it is not the print's in the user's language (VB-86/VB-87).
  const note = [
    view.imageLang &&
      view.imageLang !== locale &&
      fmt(t.card.imageLang, { lang: view.imageLang.toUpperCase() }),
    view.imageFrom === 'sibling' && t.card.imageSibling,
  ]
    .filter(Boolean)
    .join(' · ');
  const stage = (
    <CardStage
      game={game}
      format={print?.cardFormat}
      uri={view.image}
      label={view.name}
      wide={wide}
      note={note}
    />
  );
  const notice = <RightsNotice game={game} artist={print?.artist} copyright={data.copyright} />;
  const prices = print && (
    <PricePanel key={print.id} printId={print.id} finishes={print.finishes} />
  );
  const details = (
    <>
      {print && (
        <PrintsTable
          prints={data.prints}
          current={print.id}
          cardId={card.id}
          game={game}
          // The full columns need the room of a 1024 px window (the 320 px image column takes it
          // below), and in the third zone a 1760 px one, where that zone is 640 px wide.
          wide={three ? width >= 1760 : width >= 1024}
        />
      )}
      <View className={half ? 'flex-row items-start gap-4' : 'gap-4'}>
        <Legality game={game} legalities={card.legalities} className={half} />
        <CardText text={view.text} lang={view.textLang} print={print} className={half} />
      </View>
    </>
  );

  if (!wide) {
    return (
      <View className="gap-5">
        {stage}
        {header}
        {prices}
        {details}
        {notice}
      </View>
    );
  }
  return (
    <View className={`flex-row items-start ${three ? 'gap-8' : 'gap-10'}`}>
      <View className={`gap-4 ${width >= 1180 ? 'w-[400px]' : 'w-[320px]'}`}>
        {stage}
        {print && <PrintThumbs prints={data.prints} current={print.id} onPick={pick} />}
        {notice}
      </View>
      {three ? (
        <>
          {/* The prices get the larger share: at 1600 px the chips keep their price on one line. */}
          <View className="min-w-[496px] flex-[1.25] gap-5">
            {header}
            {prices}
          </View>
          <View className="min-w-[440px] flex-1 gap-5">{details}</View>
        </>
      ) : (
        <View className="min-w-0 flex-1 gap-5">
          {header}
          {prices}
          {details}
        </View>
      )}
    </View>
  );
}

export default function CardPage() {
  const t = useT();
  const { id, print } = useLocalSearchParams<{ id: string; print?: string }>();
  const card = useCard(id);
  const view = useView(card.data, print);
  const name = view?.name ?? '';
  const crumbs: Crumb[] =
    card.data && view
      ? [
          { label: t.games[card.data.card.game], href: `/${card.data.card.game}` },
          ...(view.print
            ? [
                {
                  label: view.print.set.name,
                  href: `/${card.data.card.game}/sets/${view.print.set.code}` as const,
                },
              ]
            : []),
          { label: name },
        ]
      : [{ label: ' ' }];
  return (
    <Page title={name || ' '} back catalog crumbs={crumbs}>
      <QueryState query={card}>{(data) => <CardView data={data} printId={print} />}</QueryState>
    </Page>
  );
}
