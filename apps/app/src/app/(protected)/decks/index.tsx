import { DECK_FORMATS, type DeckGame, type DeckSummary } from '@voidbinder/shared/api';
import { Link, router } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ApiError } from '../../../api/queries/http';
import { useCreateDeck, useDecks } from '../../../api/queries/decks';
import { GameSquare, Select } from '../../../components/collection/Controls';
import { money } from '../../../components/collection/format';
import { FormatChip } from '../../../components/deck/DeckHeader';
import { headline } from '../../../components/deck/format';
import { Heading, Page, useWide } from '../../../components/Shell';
import { Button, Field, Note, Panel, QueryState, Segmented } from '../../../components/ui';
import { fmt, useLocale, useT } from '../../../i18n';

const GAMES: DeckGame[] = ['pokemon', 'yugioh', 'mtg'];

/** One deck: game colour, name, format chip with its legality, size, value, missing copies. */
function DeckRow({ deck }: { deck: DeckSummary }) {
  const t = useT();
  const locale = useLocale();
  const value = headline(deck.value.totals);
  return (
    <Link href={`/decks/${deck.id}`} asChild>
      <Pressable
        role="link"
        className="flex-row flex-wrap items-center gap-x-4 gap-y-2 border-t border-line py-3.5"
      >
        <View className="min-w-[200px] flex-1 flex-row items-center gap-3">
          <GameSquare game={deck.game} />
          <View className="min-w-0 flex-1">
            <Text numberOfLines={1} className="font-display text-base font-semibold text-ink">
              {deck.name}
            </Text>
            <Text className="font-body text-[13px] text-ink-2">
              {t.collection.gameShort[deck.game]} · {fmt(t.decks.cards, { count: deck.cards })}
            </Text>
          </View>
        </View>
        <FormatChip format={deck.format} problems={deck.problems} />
        <Text className="w-[96px] text-right font-mono text-sm font-semibold text-ink">
          {value ? money(value.main.cents, value.main.currency, locale) : t.decks.noPrice}
        </Text>
        <Text className="w-[150px] font-body text-[13px] text-ink-2">
          {deck.missing ? fmt(t.decks.missing, { count: deck.missing }) : t.decks.complete}
        </Text>
      </Pressable>
    </Link>
  );
}

/** Game, format and name; opens the new deck. The id is made once per attempt, so a retry is safe. */
function CreateDeck() {
  const t = useT();
  const create = useCreateDeck();
  const [game, setGame] = useState<DeckGame>('yugioh');
  const [format, setFormat] = useState<string>(DECK_FORMATS.yugioh[0]);
  const [name, setName] = useState('');
  const [error, setError] = useState<string>();
  const id = useRef(crypto.randomUUID());
  const submit = () => {
    if (!name.trim()) return setError(t.decks.nameMissing);
    setError(undefined);
    create.mutate(
      { id: id.current, game, format, name: name.trim() },
      {
        onSuccess: (deck) => {
          id.current = crypto.randomUUID();
          router.push(`/decks/${deck.id}`);
        },
      },
    );
  };
  return (
    <Panel>
      <Text role="heading" aria-level={2} className="font-display text-lg font-bold text-ink">
        {t.decks.new}
      </Text>
      <Segmented
        label={t.decks.game}
        value={game}
        options={GAMES.map((g) => ({ value: g, label: t.collection.gameShort[g] }))}
        onChange={(g) => {
          setGame(g);
          setFormat(DECK_FORMATS[g][0]);
        }}
      />
      <Select
        label={t.decks.format}
        value={format}
        options={DECK_FORMATS[game].map((f) => ({ value: f, label: t.decks.formats[f] ?? f }))}
        onChange={setFormat}
      />
      <Field
        label={t.decks.name}
        value={name}
        onChangeText={setName}
        onSubmitEditing={submit}
        error={error}
        maxLength={80}
      />
      <Button wide label={t.decks.create} busy={create.isPending} onPress={submit} />
      {create.isError && !(create.error instanceof ApiError && create.error.status === 400) && (
        <Note tone="error">{t.decks.createFailed}</Note>
      )}
    </Panel>
  );
}

/** `/decks`: the user's decks and a new one. */
export default function Decks() {
  const t = useT();
  const wide = useWide();
  const decks = useDecks();
  const list = (
    <View role="region" aria-label={t.decks.list} className="min-w-0 flex-1">
      <QueryState query={decks} isEmpty={(d) => d.decks.length === 0} empty={t.decks.empty}>
        {(data) => (
          <View role="list" className="rounded-2xl border border-line bg-surface px-5 pb-1">
            {data.decks.map((d) => (
              <View key={d.id} role="listitem" className="-mt-px">
                <DeckRow deck={d} />
              </View>
            ))}
          </View>
        )}
      </QueryState>
    </View>
  );
  return (
    <Page title={t.decks.title} catalog>
      <Heading lede={t.decks.lede}>{t.decks.title}</Heading>
      {wide ? (
        <View className="flex-row items-start gap-6">
          {list}
          <View className="w-[340px]">
            <CreateDeck />
          </View>
        </View>
      ) : (
        <View className="gap-6">
          <CreateDeck />
          {list}
        </View>
      )}
    </Page>
  );
}
