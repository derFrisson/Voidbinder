import { deckGroup, isExtraDeck } from '@voidbinder/core';
import type { DeckDetail, DeckEntry, DeckZone, SearchHit } from '@voidbinder/shared/api';
import { DECK_ZONES } from '@voidbinder/shared/api';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View, useWindowDimensions } from 'react-native';
import { useDeck, useDeckEntries, usePutEntries } from '../../../api/queries/decks';
import { AddCards } from '../../../components/deck/AddCards';
import { DeckHeader } from '../../../components/deck/DeckHeader';
import { DeckList, ZoneTabs } from '../../../components/deck/DeckList';
import { Curve, Missing } from '../../../components/deck/Missing';
import { Page } from '../../../components/Shell';
import { Note, QueryState } from '../../../components/ui';
import { useT } from '../../../i18n';

/** A search hit as a deck line until the API answers with the real one. */
function newLine(game: DeckDetail['game'], hit: SearchHit, zone: DeckZone): DeckEntry {
  const typeLine = hit.typeLine ?? null;
  return {
    cardId: hit.cardId,
    printId: hit.id,
    zone,
    quantity: 1,
    name: hit.name,
    typeLine,
    group: deckGroup(game, {
      cardId: hit.cardId,
      name: hit.name,
      typeLine,
      text: null,
      attributes: {},
      legalities: {},
      zone,
      quantity: 1,
    }),
    stat: null,
    print: {
      id: hit.id,
      setCode: hit.setCode,
      number: hit.number,
      displayNumber: hit.displayNumber,
      displayCode: hit.displayCode,
      cardFormat: hit.cardFormat,
      rarity: hit.rarity,
      finishes: hit.finishes,
      imageUrl: hit.imageUrl,
    },
    owned: 0,
    limit: null,
    price: null,
  };
}

function DeckBuilder({ deck: answer }: { deck: DeckDetail }) {
  const t = useT();
  const three = useWindowDimensions().width >= 1200;
  const put = usePutEntries(answer.id);
  // The deck with the writes still on their way.
  const deck = { ...answer, entries: useDeckEntries(answer.id, answer.entries) };
  // The zones the format counts, the main deck first open (Magic's commander zone in Commander).
  const zones = DECK_ZONES[deck.game].filter((z) => z in deck.analysis.rules.zones);
  const [zone, setZone] = useState<DeckZone>('main');

  const same = (a: { cardId: string; zone: DeckZone }, cardId: string, z: DeckZone) =>
    a.cardId === cardId && a.zone === z;
  // Relative to the list the write runs on: two quick steps are two steps.
  const setQuantity = (entry: DeckEntry, quantity: number) => {
    const delta = quantity - entry.quantity;
    put.mutate((list) =>
      list.flatMap((e) => {
        if (!same(e, entry.cardId, entry.zone)) return [e];
        const q = e.quantity + delta;
        return q > 0 ? [{ ...e, quantity: q }] : [];
      }),
    );
  };
  const add = (hit: SearchHit) => {
    // Yu-Gi-Oh!: an Extra Deck monster found with the main deck open goes to the extra deck.
    const to =
      deck.game === 'yugioh' && zone === 'main' && isExtraDeck({ typeLine: hit.typeLine ?? null })
        ? 'extra'
        : zone;
    put.mutate((list) =>
      list.some((e) => same(e, hit.cardId, to))
        ? list.map((e) => (same(e, hit.cardId, to) ? { ...e, quantity: e.quantity + 1 } : e))
        : [...list, newLine(deck.game, hit, to)],
    );
  };

  const search = <AddCards deck={deck} zone={zone} onAdd={add} />;
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
      <DeckList deck={deck} zone={zone} onQuantity={setQuantity} />
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
        // Phone order per the mockup: what is missing, adding cards, the list, the curve.
        <View className="gap-6">
          <Missing deck={deck} />
          <View className="rounded-2xl border border-line bg-surface p-5">{search}</View>
          {list}
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
      catalog
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
