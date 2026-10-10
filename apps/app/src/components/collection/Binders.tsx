import type { Game } from '@voidbinder/shared';
import type { Binder, CollectionSummary } from '@voidbinder/shared/api';
import { createElement, useState, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { ApiError } from '../../api/queries/http';
import { useCreateBinder, useOrderBinders } from '../../api/queries/collection';
import { fmt, useLocale, useT } from '../../i18n';
import { Chip } from '../card/Chip';
import { Button, Field, Note } from '../ui';
import { GameSquare, IconButton, Select } from './Controls';
import { money } from './format';

/** `null`: all cards; otherwise a binder id. */
export type BinderPick = string | null;

type Stats = CollectionSummary['collection']['binders'][number];

/** `ids` with `id` moved to `to`. */
export function moveId(ids: string[], id: string, to: number): string[] {
  const rest = ids.filter((x) => x !== id);
  rest.splice(Math.max(0, Math.min(to, rest.length)), 0, id);
  return rest;
}

function useStats(summary: CollectionSummary | undefined) {
  const locale = useLocale();
  const t = useT();
  return (binderId: string | null | 'all') => {
    const s: Pick<Stats, 'cards' | 'totals'> | undefined =
      binderId === 'all'
        ? summary?.collection
        : summary?.collection.binders.find((b) => b.binderId === binderId);
    const total = s?.totals[0];
    return {
      cards: s?.cards ?? 0,
      value: total
        ? money(total.cents, total.currency, locale)
        : s?.cards
          ? ''
          : t.collection.emptyShort,
    };
  };
}

function NewBinder({ onDone }: { onDone: () => void }) {
  const t = useT();
  const create = useCreateBinder();
  const [name, setName] = useState('');
  const [game, setGame] = useState<Game | ''>('');
  const taken = create.error instanceof ApiError && create.error.status === 409;
  const submit = () => {
    if (!name.trim()) return;
    create.mutate({ name: name.trim(), game: game || null }, { onSuccess: () => onDone() });
  };
  return (
    <View className="gap-3 rounded-xl border border-line p-3">
      <Field
        label={t.collection.binderName}
        value={name}
        onChangeText={setName}
        onSubmitEditing={submit}
        maxLength={60}
        autoFocus
      />
      <Select
        label={t.collection.binderGame}
        value={game}
        onChange={setGame}
        options={[
          { value: '', label: t.collection.mixed },
          ...(['pokemon', 'yugioh', 'mtg'] as const).map((g) => ({ value: g, label: t.games[g] })),
        ]}
      />
      {taken && <Note tone="error">{t.collection.binderTaken}</Note>}
      {create.error && !taken && <Note tone="error">{t.state.error}</Note>}
      <View className="flex-row flex-wrap gap-2">
        <Button
          label={t.collection.create}
          onPress={submit}
          busy={create.isPending}
          disabled={!name.trim()}
        />
        <Button variant="ghost" label={t.collection.cancel} onPress={onDone} />
      </View>
    </View>
  );
}

/** A row that can be dragged onto another one; on the web only (HTML drag and drop). */
function Draggable({
  id,
  index,
  dragging,
  onDrag,
  onDrop,
  children,
}: {
  id: string;
  index: number;
  dragging: string | null;
  onDrag: (id: string | null) => void;
  onDrop: (index: number) => void;
  children: ReactNode;
}) {
  if (Platform.OS !== 'web') return <>{children}</>;
  return createElement(
    'div',
    {
      draggable: true,
      onDragStart: (e: DragEvent) => {
        e.dataTransfer?.setData('text/plain', id);
        onDrag(id);
      },
      onDragOver: (e: DragEvent) => e.preventDefault(),
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        onDrop(index);
      },
      onDragEnd: () => onDrag(null),
      className: dragging === id ? 'opacity-50' : '',
    },
    children,
  );
}

/**
 * The binder sidebar (wide screens): "Alle Karten", then the binders in their order with the game
 * colour, count and value; drag to reorder, or the sort button's up/down arrows (keyboard).
 */
export function BinderSidebar({
  binders,
  summary,
  pick,
  onPick,
}: {
  binders: Binder[];
  summary: CollectionSummary | undefined;
  pick: BinderPick;
  onPick: (pick: BinderPick) => void;
}) {
  const t = useT();
  const stats = useStats(summary);
  const order = useOrderBinders();
  const [sorting, setSorting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const ids = binders.map((b) => b.id);
  const move = (id: string, to: number) => order.mutate(moveId(ids, id, to));

  const row = (b: Binder | null, i: number) => {
    const id = b?.id ?? null;
    const s = stats(b ? b.id : 'all');
    const current = pick === id;
    return (
      <View className="flex-row items-center">
        <Pressable
          role="button"
          aria-current={current ? 'true' : undefined}
          onPress={() => onPick(id)}
          className={`min-w-0 flex-1 flex-row items-center gap-3 rounded-xl px-3 py-2.5 ${current ? 'bg-blue-soft' : ''}`}
        >
          <GameSquare game={b ? b.game : null} />
          <View className="min-w-0 flex-1">
            <Text numberOfLines={1} className="font-display text-[15px] font-semibold text-ink">
              {b?.name ?? t.collection.allCards}
            </Text>
            {s.value !== '' && <Text className="font-mono text-xs text-ink-2">{s.value}</Text>}
          </View>
          <Text className="font-mono text-[13px] text-ink-2">{s.cards}</Text>
        </Pressable>
        {sorting && b && (
          <View className="flex-row">
            <IconButton
              icon="up"
              label={fmt(t.collection.moveUp, { name: b.name })}
              disabled={i === 0}
              onPress={() => move(b.id, i - 1)}
            />
            <IconButton
              icon="down"
              label={fmt(t.collection.moveDown, { name: b.name })}
              disabled={i === binders.length - 1}
              onPress={() => move(b.id, i + 1)}
            />
          </View>
        )}
      </View>
    );
  };

  return (
    <View
      role="region"
      aria-label={t.collection.binders}
      className="w-[268px] gap-3 self-start rounded-2xl border border-line bg-surface p-3"
    >
      <View className="flex-row items-center justify-between pl-3">
        <Text role="heading" aria-level={2} className="font-display text-base font-bold text-ink">
          {t.collection.binders}
        </Text>
        <IconButton
          icon={sorting ? 'check' : 'sort'}
          label={sorting ? t.collection.sortDone : t.collection.sortBinders}
          expanded={sorting}
          onPress={() => setSorting(!sorting)}
        />
      </View>
      {row(null, -1)}
      <View className="gap-0.5 border-t border-line pt-2">
        {binders.map((b, i) => (
          <Draggable
            key={b.id}
            id={b.id}
            index={i}
            dragging={dragging}
            onDrag={setDragging}
            onDrop={(to) => dragging && move(dragging, to)}
          >
            {row(b, i)}
          </Draggable>
        ))}
      </View>
      {adding ? (
        <NewBinder onDone={() => setAdding(false)} />
      ) : (
        <Button
          variant="ghost"
          wide
          label={`+ ${t.collection.newBinder}`}
          onPress={() => setAdding(true)}
        />
      )}
      <Text className="px-1 font-body text-[12.5px] leading-5 text-ink-3">
        {t.collection.binderHint}
      </Text>
    </View>
  );
}

/** Phone: the binders as chips that scroll sideways; sorting and adding open below them. */
export function BinderChips({
  binders,
  summary,
  pick,
  onPick,
}: {
  binders: Binder[];
  summary: CollectionSummary | undefined;
  pick: BinderPick;
  onPick: (pick: BinderPick) => void;
}) {
  const t = useT();
  const stats = useStats(summary);
  const order = useOrderBinders();
  const [panel, setPanel] = useState<'sort' | 'add' | null>(null);
  const ids = binders.map((b) => b.id);
  return (
    <View className="gap-3">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-4 px-4">
        <View role="group" aria-label={t.collection.binders} className="flex-row gap-2 pr-8">
          <Chip
            label={`${t.collection.allCards}  ${stats('all').cards}`}
            pressed={pick === null}
            onPress={() => onPick(null)}
          />
          {binders.map((b) => (
            <Chip
              key={b.id}
              label={`${b.name}  ${stats(b.id).cards}`}
              pressed={pick === b.id}
              onPress={() => onPick(b.id)}
            />
          ))}
          <Chip
            label={`+ ${t.collection.newBinder}`}
            pressed={panel === 'add'}
            onPress={() => setPanel(panel === 'add' ? null : 'add')}
          />
          {binders.length > 1 && (
            <Chip
              label={panel === 'sort' ? t.collection.sortDone : t.collection.sortBinders}
              pressed={panel === 'sort'}
              onPress={() => setPanel(panel === 'sort' ? null : 'sort')}
            />
          )}
        </View>
      </ScrollView>
      {panel === 'add' && <NewBinder onDone={() => setPanel(null)} />}
      {panel === 'sort' && (
        <View className="gap-1 rounded-xl border border-line bg-surface p-2">
          {binders.map((b, i) => (
            <View key={b.id} className="flex-row items-center gap-2 pl-2">
              <GameSquare game={b.game} />
              <Text
                numberOfLines={1}
                className="flex-1 font-display text-[15px] font-semibold text-ink"
              >
                {b.name}
              </Text>
              <IconButton
                icon="up"
                label={fmt(t.collection.moveUp, { name: b.name })}
                disabled={i === 0}
                onPress={() => order.mutate(moveId(ids, b.id, i - 1))}
              />
              <IconButton
                icon="down"
                label={fmt(t.collection.moveDown, { name: b.name })}
                disabled={i === binders.length - 1}
                onPress={() => order.mutate(moveId(ids, b.id, i + 1))}
              />
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
