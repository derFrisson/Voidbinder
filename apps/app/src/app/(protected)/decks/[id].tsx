import type { DeckDetail, DeckEntry, DeckZone, SearchHit } from '@voidbinder/shared/api';
import { DECK_ZONES } from '@voidbinder/shared/api';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View, useWindowDimensions } from 'react-native';
import { toInput, useDeck, usePutEntries } from '../../../api/queries/decks';
import { AddCards } from '../../../components/deck/AddCards';
import { DeckHeader } from '../../../components/deck/DeckHeader';
import { DeckList, ZoneTabs } from '../../../components/deck/DeckList';
import { Curve, Missing } from '../../../components/deck/Missing';
import { Page } from '../../../components/Shell';
import { Note, QueryState } from '../../../components/ui';
import { useT } from '../../../i18n';

/** Copies of a name the + allows: Yu-Gi-Oh! has no exceptions; Magic and Pokémon do (basics). */
const copyLimit = (deck: DeckDetail) =>
  deck.game === 'yugioh' ? deck.analysis.rules.copies : Infinity;

function DeckBuilder({ deck }: { deck: DeckDetail }) {
  const t = useT();
  const three = useWindowDimensions().width >= 1200;
  // The zones the format counts, the main deck first open (Magic's commander zone in Commander).
  const zones = DECK_ZONES[deck.game].filter((z) => z in deck.analysis.rules.zones);
  const [zone, setZone] = useState<DeckZone>('main');
  const put = usePutEntries(deck.id);

  const setQuantity = (entry: DeckEntry, quantity: number) =>
    put.mutate(
      toInput(deck.entries).flatMap((e) =>
        e.cardId === entry.cardId && e.zone === entry.zone
          ? quantity > 0
            ? [{ ...e, quantity }]
            : []
          : [e],
      ),
    );
  const add = (hit: SearchHit) => {
    const list = toInput(deck.entries);
    const line = list.find((e) => e.cardId === hit.cardId && e.zone === zone);
    put.mutate(
      line
        ? list.map((e) => (e === line ? { ...e, quantity: e.quantity + 1 } : e))
        : [...list, { cardId: hit.cardId, printId: hit.id, zone, quantity: 1 }],
    );
  };

  const search = <AddCards deck={deck} zone={zone} onAdd={add} copyLimit={copyLimit(deck)} />;
  const list = (
    <View
      role="region"
      aria-label={t.decks.deckList.title}
      className="gap-4 rounded-2xl border border-line bg-surface p-5"
    >
      <View className="flex-row flex-wrap items-center justify-between gap-3">
        <Text role="heading" aria-level={2} className="font-display text-lg font-bold text-ink">
          {t.decks.deckList.title}
        </Text>
        <ZoneTabs zones={zones} zone={zone} counts={deck.analysis.counts} onZone={setZone} />
      </View>
      {put.isError && <Note tone="error">{t.decks.deckList.saveFailed}</Note>}
      <DeckList deck={deck} zone={zone} onQuantity={setQuantity} copyLimit={copyLimit(deck)} />
    </View>
  );

  return (
    <>
      <DeckHeader deck={deck} />
      {three ? (
        <View className="flex-row items-start gap-6">
          <View className="w-[300px] rounded-2xl border border-line bg-surface p-5">{search}</View>
          <View className="min-w-0 flex-1">{list}</View>
          <View className="w-[340px] gap-6">
            <Missing deck={deck} />
            <Curve deck={deck} />
          </View>
        </View>
      ) : (
        <View className="gap-6">
          <Missing deck={deck} />
          {list}
          <View className="rounded-2xl border border-line bg-surface p-5">{search}</View>
          <Curve deck={deck} />
        </View>
      )}
    </>
  );
}

/** `/decks/:id`: the deck builder (docs/app/mockups/deck.html). */
export default function DeckPage() {
  const t = useT();
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const deck = useDeck(id);
  const name = deck.data?.name ?? t.decks.title;
  return (
    <Page
      title={name}
      back
      crumbs={[
        { label: t.decks.title, href: '/decks' },
        ...(deck.data ? [{ label: t.collection.gameShort[deck.data.game] }] : []),
        { label: name },
      ]}
    >
      <QueryState query={deck}>{(data) => <DeckBuilder deck={data} />}</QueryState>
    </Page>
  );
}
