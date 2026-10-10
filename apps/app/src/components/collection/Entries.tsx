import type {
  Binder,
  CollectionCondition,
  CollectionEntry,
  EntryPrint,
} from '@voidbinder/shared/api';
import { cardAspect } from '@voidbinder/shared';
import { Link } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, Text, TextInput, View } from 'react-native';
import { useDeleteEntry, useUpdateEntry } from '../../api/queries/collection';
import { useSession } from '../../api/queries/me';
import { fmt, useLocale, useT } from '../../i18n';
import { hitHref } from '../../hooks/browsing-language';
import { BanBadge, useBanStatus } from '../banlist/BanBadge';
import { label } from '../card/attributes';
import { fieldClass } from '../card/game';
import { PriceLang } from '../card/PriceLang';
import { useWide } from '../Shell';
import { Button, Field, Note, Segmented } from '../ui';
import { FieldLabel, GameSquare, IconButton, Select, Stepper, Tag } from './Controls';
import {
  CONDITIONS,
  centsText,
  day,
  LANGUAGES,
  money,
  parseCents,
  signedMoney,
  SOURCE_NAMES,
} from './format';

const head = 'font-display text-[11.5px] font-semibold uppercase tracking-wider text-ink-3';

/** A small card image in its format's box (contained), or the game's soft field while there is none. */
export function Thumb({ print }: { print: Pick<EntryPrint, 'imageUrl' | 'game' | 'cardFormat'> }) {
  const [failed, setFailed] = useState(false);
  const box = { aspectRatio: cardAspect(print.cardFormat) };
  return print.imageUrl && !failed ? (
    <Image
      aria-hidden
      source={{ uri: print.imageUrl }}
      onError={() => setFailed(true)}
      resizeMode="contain"
      style={box}
      className="w-[30px] rounded"
    />
  ) : (
    <View aria-hidden style={box} className={`w-[30px] rounded ${fieldClass[print.game].soft}`} />
  );
}

/** Name, set code and number; links to the card page with the print selected. */
export function CardCell({ print, lang }: { print: EntryPrint; lang?: string | undefined }) {
  const locale = useLocale();
  // VB-81: the TCG ban list status of a Yu-Gi-Oh! card.
  const ban = useBanStatus(print.game, print.cardId);
  return (
    <Link href={hitHref({ cardId: print.cardId, id: print.id, lang }, locale)} asChild>
      <Pressable className="min-w-0 flex-1 flex-row items-center gap-3">
        <Thumb print={print} />
        <View className="min-w-0 flex-1">
          <View className="flex-row items-center gap-2">
            <Text
              numberOfLines={2}
              className="shrink font-display text-[15px] font-semibold leading-5 text-ink"
            >
              {print.name}
            </Text>
            {ban && <BanBadge status={ban} format="tcg" />}
          </View>
          <Text numberOfLines={1} className="font-mono text-xs text-ink-2">
            {print.setCode.toUpperCase()} · {print.displayNumber}
          </Text>
        </View>
      </Pressable>
    </Link>
  );
}

const total = (e: CollectionEntry) => (e.price ? e.price.unitCents * e.quantity : null);

/** The inline form under a row (docs/app/mockups/collection.html, `.edit`). */
function EditEntry({
  entry,
  binders,
  onClose,
}: {
  entry: CollectionEntry;
  binders: Binder[];
  onClose: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const wide = useWide();
  const update = useUpdateEntry();
  const remove = useDeleteEntry();
  const { data: me } = useSession();
  const [quantity, setQuantity] = useState(entry.quantity);
  const [language, setLanguage] = useState(entry.language);
  const [finish, setFinish] = useState(entry.finish);
  const [binderId, setBinderId] = useState(entry.binderId ?? '');
  const [purchase, setPurchase] = useState(centsText(entry.purchasePriceCents, locale));
  const [condition, setCondition] = useState<CollectionCondition>(entry.condition);
  const [note, setNote] = useState(entry.note ?? '');
  const [confirming, setConfirming] = useState(false);
  const e = t.collection.edit;
  const finishes = [...new Set([...entry.print.finishes, entry.finish])];
  const languages = [...new Set([...LANGUAGES, entry.language])];
  const purchaseCents = parseCents(purchase);
  const invalidPrice = purchaseCents === 'invalid';

  const save = () => {
    if (purchaseCents === 'invalid') return;
    update.mutate(
      {
        id: entry.id,
        quantity,
        language,
        finish,
        condition,
        binderId: binderId || null,
        purchasePriceCents: purchaseCents,
        // The stored currency stays; a first price is in the one the entry is valued in.
        purchaseCurrency:
          purchaseCents === null
            ? null
            : (entry.purchaseCurrency ?? entry.price?.currency ?? me?.currency ?? 'EUR'),
        note: note.trim() || null,
      },
      { onSuccess: onClose },
    );
  };

  const price = entry.price;
  const gain =
    price &&
    entry.purchasePriceCents !== null &&
    (entry.purchaseCurrency ?? price.currency) === price.currency
      ? (price.unitCents - entry.purchasePriceCents) * entry.quantity
      : null;
  const field = wide ? 'min-w-[150px] flex-1' : 'w-full';
  const titleId = `edit-${entry.id}`;

  return (
    <View
      role="form"
      aria-labelledby={titleId}
      className="gap-4 rounded-2xl border border-line bg-surface p-5"
    >
      <View className="flex-row items-start justify-between gap-3">
        <Text
          nativeID={titleId}
          role="heading"
          aria-level={3}
          className="flex-1 font-display text-lg font-bold text-ink"
        >
          {e.title}{' '}
          <Text className="font-mono text-[13px] font-medium text-ink-2">
            {entry.print.name} · {entry.print.setCode.toUpperCase()} {entry.print.displayNumber}
          </Text>
        </Text>
        <IconButton icon="close" label={e.close} onPress={onClose} />
      </View>
      <View className={wide ? 'flex-row flex-wrap gap-x-6 gap-y-4' : 'gap-4'}>
        <View className={`gap-1.5 ${field}`}>
          <FieldLabel>{e.quantity}</FieldLabel>
          <Stepper value={quantity} onChange={setQuantity} label={{ less: e.less, more: e.more }} />
        </View>
        <View className={field}>
          <Select
            label={e.language}
            value={language}
            onChange={setLanguage}
            options={languages.map((l) => ({
              value: l,
              label: t.collection.languages[l] ?? l.toUpperCase(),
            }))}
          />
        </View>
        {finishes.length > 1 && (
          <View className={field}>
            <Segmented
              label={e.finish}
              value={finish}
              onChange={setFinish}
              options={finishes.map((f) => ({ value: f, label: label(t.card.finishes, f) }))}
            />
          </View>
        )}
        <View className={field}>
          <Select
            label={e.binder}
            value={binderId}
            onChange={setBinderId}
            options={[
              { value: '', label: e.noBinder },
              ...binders.map((b) => ({ value: b.id, label: b.name })),
            ]}
          />
        </View>
        <View className={field}>
          <Field
            label={e.purchase}
            value={purchase}
            onChangeText={setPurchase}
            inputMode="decimal"
            placeholder="0,00"
            error={invalidPrice ? e.invalidPrice : undefined}
          />
        </View>
        <View className="w-full">
          <Segmented
            label={e.condition}
            value={condition}
            onChange={setCondition}
            options={CONDITIONS.map((c) => ({ value: c, label: c }))}
          />
        </View>
        <View className="w-full gap-1.5">
          <FieldLabel>{e.note}</FieldLabel>
          <TextInput
            aria-label={e.note}
            value={note}
            onChangeText={setNote}
            maxLength={500}
            className="h-11 rounded-xl border border-line bg-surface px-3 font-body text-[15px] text-ink"
          />
        </View>
      </View>
      {update.isError && <Note tone="error">{e.saveFailed}</Note>}
      <View
        className={`border-t border-line pt-4 ${wide ? 'flex-row items-center justify-between gap-4' : 'gap-4'}`}
      >
        <View className="flex-1 flex-row items-start gap-1.5">
          <PriceLang lang={price?.lang} shown={entry.language} />
          <Text className="flex-1 font-body text-[13px] leading-5 text-ink-2">
            {price
              ? fmt(e.value, {
                  calc: `${entry.quantity} × ${money(price.unitCents, price.currency, locale)} = ${money(price.unitCents * entry.quantity, price.currency, locale)}`,
                  source: SOURCE_NAMES[price.source],
                  date: day(price.observedAt, locale),
                })
              : t.collection.table.noPrice}
            {gain !== null && price
              ? ` ${fmt(e.gain, { amount: signedMoney(gain, price.currency, locale) })}`
              : ''}
          </Text>
        </View>
        {confirming ? (
          <View className="flex-row flex-wrap items-center gap-2">
            <Text className="font-body text-sm text-ink">{e.confirmDelete}</Text>
            <Button
              variant="danger"
              label={e.confirm}
              busy={remove.isPending}
              onPress={() => remove.mutate(entry.id, { onSuccess: onClose })}
            />
            <Button variant="ghost" label={e.cancel} onPress={() => setConfirming(false)} />
          </View>
        ) : (
          <View className="flex-row flex-wrap items-center gap-2">
            <Button variant="ghost" label={e.delete} onPress={() => setConfirming(true)} />
            <Button variant="ghost" label={e.cancel} onPress={onClose} />
            <Button label={e.save} onPress={save} busy={update.isPending} disabled={invalidPrice} />
          </View>
        )}
      </View>
    </View>
  );
}

/** The have list: a table on wide screens, a list on phones; the edit form opens under its row. */
export function EntryList({ entries, binders }: { entries: CollectionEntry[]; binders: Binder[] }) {
  const t = useT();
  const locale = useLocale();
  const wide = useWide();
  const update = useUpdateEntry();
  const [editing, setEditing] = useState<string | null>(null);
  const h = t.collection.table;
  const binderOf = (id: string | null) => binders.find((b) => b.id === id);
  const toggle = (id: string) => setEditing(editing === id ? null : id);
  const stepper = (e: CollectionEntry) => (
    <Stepper
      value={e.quantity}
      onChange={(quantity) => update.mutate({ id: e.id, quantity })}
      label={{
        less: fmt(h.less, { name: e.print.name }),
        more: fmt(h.more, { name: e.print.name }),
      }}
    />
  );
  const amount = (cents: number | null, e: CollectionEntry) =>
    cents === null || !e.price ? h.noPrice : money(cents, e.price.currency, locale);

  if (!wide) {
    return (
      <View role="list" aria-label={h.label} className="gap-2">
        {entries.map((e) => (
          <View key={e.id} role="listitem" className="gap-2">
            <View
              className={`flex-row items-center rounded-xl border bg-surface ${editing === e.id ? 'border-blue' : 'border-line'}`}
            >
              {/* The picture opens the card in the copy's language (VB-108); the rest of the row edits. */}
              <Link
                href={hitHref({ cardId: e.print.cardId, id: e.print.id, lang: e.language }, locale)}
                asChild
              >
                <Pressable
                  aria-label={e.print.name}
                  className="min-h-[44px] justify-center self-stretch py-2.5 pl-3 pr-3"
                >
                  <Thumb print={e.print} />
                </Pressable>
              </Link>
              <Pressable
                role="button"
                aria-expanded={editing === e.id}
                aria-label={fmt(h.edit, { name: e.print.name })}
                onPress={() => toggle(e.id)}
                className="min-w-0 flex-1 flex-row items-center gap-3 py-2.5 pr-3"
              >
                <View className="min-w-0 flex-1">
                  <Text
                    numberOfLines={1}
                    className="font-display text-[15px] font-semibold text-ink"
                  >
                    {e.print.name}
                  </Text>
                  <Text numberOfLines={1} className="font-mono text-xs text-ink-2">
                    {e.print.displayNumber} · {e.language.toUpperCase()} · {e.condition} ·{' '}
                    {label(t.card.finishes, e.finish)}
                  </Text>
                </View>
                <Text className="font-mono text-[13px] text-ink-2">{e.quantity}×</Text>
                <PriceLang lang={e.price?.lang} shown={e.language} />
                <Text className="min-w-[64px] text-right font-mono text-sm font-semibold text-ink">
                  {amount(total(e), e)}
                </Text>
              </Pressable>
            </View>
            {editing === e.id && (
              <EditEntry entry={e} binders={binders} onClose={() => setEditing(null)} />
            )}
          </View>
        ))}
      </View>
    );
  }

  return (
    <View
      role="table"
      aria-label={h.label}
      className="rounded-2xl border border-line bg-surface px-3 pb-1"
    >
      <View role="row" className="flex-row items-center gap-3 border-b border-line px-2 py-3">
        <Text role="columnheader" className={`flex-1 ${head}`}>
          {h.card}
        </Text>
        <Text role="columnheader" className={`w-[96px] ${head}`}>
          {h.quantity}
        </Text>
        <Text role="columnheader" numberOfLines={1} className={`w-[72px] ${head}`}>
          {h.language}
        </Text>
        <Text role="columnheader" numberOfLines={1} className={`w-[72px] ${head}`}>
          {h.condition}
        </Text>
        <Text role="columnheader" numberOfLines={1} className={`w-[96px] ${head}`}>
          {h.finish}
        </Text>
        <Text role="columnheader" className={`w-[124px] ${head}`}>
          {h.binder}
        </Text>
        <Text role="columnheader" className={`w-[68px] text-right ${head}`}>
          {h.unit}
        </Text>
        <Text role="columnheader" className={`w-[80px] text-right ${head}`}>
          {h.total}
        </Text>
        <View aria-hidden className="w-9" />
      </View>
      {entries.map((e) => {
        const binder = binderOf(e.binderId);
        const open = editing === e.id;
        return (
          <View key={e.id}>
            <View
              role="row"
              className={`flex-row items-center gap-3 border-b border-line px-2 py-2.5 ${open ? 'border-l-[3px] border-l-blue bg-page' : ''}`}
            >
              <View role="cell" className="min-w-0 flex-1">
                <CardCell print={e.print} lang={e.language} />
              </View>
              <View role="cell" className="w-[96px]">
                {/* While the form is open it is the one place to edit; the row shows the number. */}
                {open ? (
                  <Text className="px-3 font-mono text-[14px] font-semibold text-ink">
                    {e.quantity}
                  </Text>
                ) : (
                  stepper(e)
                )}
              </View>
              <View role="cell" className="w-[72px]">
                <Tag>{e.language.toUpperCase()}</Tag>
              </View>
              <View role="cell" className="w-[72px]">
                <Tag>{e.condition}</Tag>
              </View>
              <Text role="cell" numberOfLines={1} className="w-[96px] font-body text-sm text-ink">
                {label(t.card.finishes, e.finish)}
              </Text>
              <View role="cell" className="w-[124px] flex-row items-center gap-2">
                {binder && <GameSquare game={binder.game} />}
                <Text numberOfLines={1} className="flex-1 font-body text-sm text-ink">
                  {binder?.name ?? ''}
                </Text>
              </View>
              <View role="cell" className="w-[68px] flex-row items-center justify-end gap-1">
                <PriceLang lang={e.price?.lang} shown={e.language} />
                <Text className="font-mono text-sm text-ink-2">
                  {e.price ? money(e.price.unitCents, e.price.currency, locale) : ''}
                </Text>
              </View>
              <Text
                role="cell"
                className="w-[80px] text-right font-mono text-sm font-semibold text-ink"
              >
                {amount(total(e), e)}
              </Text>
              <View role="cell" className="w-9">
                <IconButton
                  icon="edit"
                  label={fmt(h.edit, { name: e.print.name })}
                  expanded={open}
                  onPress={() => toggle(e.id)}
                />
              </View>
            </View>
            {open && (
              <View
                role="row"
                className="border-b border-l-[3px] border-line border-l-blue bg-page p-3"
              >
                <View role="cell" className="flex-1">
                  <EditEntry entry={e} binders={binders} onClose={() => setEditing(null)} />
                </View>
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

/** The sum of the shown page in its currencies ("Diese Seite: 136,47 €"). */
export function pageValue(entries: CollectionEntry[]) {
  const sums = new Map<string, number>();
  for (const e of entries) {
    const cents = total(e);
    if (cents !== null && e.price)
      sums.set(e.price.currency, (sums.get(e.price.currency) ?? 0) + cents);
  }
  return [...sums];
}
