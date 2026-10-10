import { inBudget } from '@voidbinder/core';
import type { CollectionCondition, WishlistEntry } from '@voidbinder/shared/api';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useDeleteWish, useUpdateWish } from '../../api/queries/collection';
import { fmt, useLocale, useT } from '../../i18n';
import { label } from '../card/attributes';
import { usePalette } from '../palette';
import { useWide } from '../Shell';
import { Button, Note, Segmented } from '../ui';
import { FieldLabel, IconButton, Select, Stepper, Tag } from './Controls';
import { CardCell, Thumb } from './Entries';
import { CONDITIONS, centsText, LANGUAGES, money, parseCents } from './format';

const head = 'font-display text-[11.5px] font-semibold uppercase tracking-wider text-ink-3';

/** "Im Rahmen" (green ink on the surface) or "+1,90 € drüber" (quiet), nothing without a wish price. */
function Status({ wish }: { wish: WishlistEntry }) {
  const t = useT();
  const locale = useLocale();
  const ok = inBudget(wish);
  if (ok === null || !wish.price || wish.maxPriceCents === null) return null;
  return ok ? (
    <Text className="font-display text-[13px] font-semibold text-ok-ink">
      ✓ {t.collection.wish.inBudget}
    </Text>
  ) : (
    <Text className="font-mono text-[13px] text-ink-2">
      {fmt(t.collection.wish.over, {
        amount: `+${money(wish.price.unitCents - wish.maxPriceCents, wish.price.currency, locale)}`,
      })}
    </Text>
  );
}

function EditWish({ wish, onClose }: { wish: WishlistEntry; onClose: () => void }) {
  const t = useT();
  const locale = useLocale();
  const palette = usePalette();
  const wide = useWide();
  const update = useUpdateWish();
  const remove = useDeleteWish();
  const [quantity, setQuantity] = useState(wish.quantity);
  const [language, setLanguage] = useState(wish.language ?? '');
  const [finish, setFinish] = useState(wish.finish ?? '');
  const [minCondition, setMinCondition] = useState<CollectionCondition | ''>(
    wish.minCondition ?? '',
  );
  const [max, setMax] = useState(centsText(wish.maxPriceCents, locale));
  const [note, setNote] = useState(wish.note ?? '');
  const [confirming, setConfirming] = useState(false);
  const w = t.collection.wish;
  const e = t.collection.edit;
  const field = wide ? 'min-w-[150px] flex-1' : 'w-full';
  const titleId = `wish-${wish.id}`;
  const save = () => {
    const maxPriceCents = parseCents(max);
    update.mutate(
      {
        id: wish.id,
        quantity,
        language: language || null,
        finish: finish || null,
        minCondition: minCondition || null,
        maxPriceCents,
        currency: maxPriceCents === null ? null : (wish.currency ?? wish.price?.currency ?? 'EUR'),
        note: note.trim() || null,
      },
      { onSuccess: onClose },
    );
  };
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
          {w.editTitle}{' '}
          <Text className="font-mono text-[13px] font-medium text-ink-2">
            {wish.print.name} · {wish.print.setCode.toUpperCase()} {wish.print.number}
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
            options={[
              { value: '', label: t.collection.languages.any ?? '' },
              ...LANGUAGES.map((l) => ({ value: l, label: t.collection.languages[l] ?? l })),
            ]}
          />
        </View>
        <View className={field}>
          <Select
            label={e.finish}
            value={finish}
            onChange={setFinish}
            options={[
              { value: '', label: t.collection.anyFinish },
              ...wish.print.finishes.map((f) => ({ value: f, label: label(t.card.finishes, f) })),
            ]}
          />
        </View>
        <View className={`gap-1.5 ${field}`}>
          <FieldLabel>{w.maxPrice}</FieldLabel>
          <TextInput
            aria-label={w.maxPrice}
            value={max}
            onChangeText={setMax}
            inputMode="decimal"
            placeholder="0,00"
            placeholderTextColor={palette.ink3}
            className="h-11 rounded-xl border border-line bg-surface px-3 font-mono text-[15px] text-ink"
          />
        </View>
        <View className="w-full">
          <Segmented
            label={w.minCondition}
            value={minCondition}
            onChange={setMinCondition}
            options={[
              { value: '' as const, label: w.any },
              ...CONDITIONS.map((c) => ({ value: c, label: c })),
            ]}
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
      <View className="flex-row flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
        {confirming ? (
          <>
            <Text className="font-body text-sm text-ink">{e.confirmDelete}</Text>
            <Button
              variant="danger"
              label={e.confirm}
              busy={remove.isPending}
              onPress={() => remove.mutate(wish.id, { onSuccess: onClose })}
            />
            <Button variant="ghost" label={e.cancel} onPress={() => setConfirming(false)} />
          </>
        ) : (
          <>
            <Button variant="ghost" label={w.delete} onPress={() => setConfirming(true)} />
            <Button variant="ghost" label={e.cancel} onPress={onClose} />
            <Button label={e.save} onPress={save} busy={update.isPending} />
          </>
        )}
      </View>
    </View>
  );
}

/** The want list: wish price against the current price of the wanted finish and condition. */
export function WishList({ wishes }: { wishes: WishlistEntry[] }) {
  const t = useT();
  const locale = useLocale();
  const wide = useWide();
  const update = useUpdateWish();
  const [editing, setEditing] = useState<string | null>(null);
  const w = t.collection.wish;
  const h = t.collection.table;
  const toggle = (id: string) => setEditing(editing === id ? null : id);
  const condition = (x: WishlistEntry) =>
    x.minCondition ? fmt(w.from, { condition: x.minCondition }) : w.any;
  const wishPrice = (x: WishlistEntry) =>
    x.maxPriceCents === null ? '' : money(x.maxPriceCents, x.currency ?? 'EUR', locale);
  const current = (x: WishlistEntry) =>
    x.price ? money(x.price.unitCents, x.price.currency, locale) : h.noPrice;

  if (!wide) {
    return (
      <View role="list" aria-label={w.table} className="gap-2">
        {wishes.map((x) => (
          <View key={x.id} role="listitem" className="gap-2">
            <Pressable
              role="button"
              aria-expanded={editing === x.id}
              aria-label={fmt(h.edit, { name: x.print.name })}
              onPress={() => toggle(x.id)}
              className={`flex-row items-center gap-3 rounded-xl border bg-surface px-3 py-2.5 ${editing === x.id ? 'border-blue' : 'border-line'}`}
            >
              <Thumb print={x.print} />
              <View className="min-w-0 flex-1 gap-0.5">
                <Text numberOfLines={1} className="font-display text-[15px] font-semibold text-ink">
                  {x.print.name}
                </Text>
                <Text numberOfLines={1} className="font-mono text-xs text-ink-2">
                  {x.print.number} · {x.quantity}× · {condition(x)}
                </Text>
                <Status wish={x} />
              </View>
              <View className="items-end">
                <Text className="font-mono text-sm font-semibold text-ink">{current(x)}</Text>
                {x.maxPriceCents !== null && (
                  <Text className="font-mono text-xs text-ink-3">{wishPrice(x)}</Text>
                )}
              </View>
            </Pressable>
            {editing === x.id && <EditWish wish={x} onClose={() => setEditing(null)} />}
          </View>
        ))}
      </View>
    );
  }

  return (
    <View
      role="table"
      aria-label={w.table}
      className="rounded-2xl border border-line bg-surface px-3 pb-1"
    >
      <View role="row" className="flex-row items-center gap-3 border-b border-line px-2 py-3">
        <Text role="columnheader" className={`flex-1 ${head}`}>
          {h.card}
        </Text>
        <Text role="columnheader" className={`w-[96px] ${head}`}>
          {h.quantity}
        </Text>
        <Text role="columnheader" className={`w-[96px] ${head}`}>
          {h.condition}
        </Text>
        <Text role="columnheader" className={`w-[64px] ${head}`}>
          {h.language}
        </Text>
        <Text role="columnheader" numberOfLines={1} className={`w-[112px] text-right ${head}`}>
          {w.wishPrice}
        </Text>
        <Text role="columnheader" className={`w-[92px] text-right ${head}`}>
          {w.current}
        </Text>
        <Text role="columnheader" className={`w-[124px] ${head}`}>
          {w.status}
        </Text>
        <View aria-hidden className="w-9" />
      </View>
      {wishes.map((x) => {
        const open = editing === x.id;
        return (
          <View key={x.id}>
            <View
              role="row"
              className={`flex-row items-center gap-3 border-b border-line px-2 py-2.5 ${open ? 'border-l-[3px] border-l-blue bg-page' : ''}`}
            >
              <View role="cell" className="min-w-0 flex-1">
                <CardCell print={x.print} />
              </View>
              <View role="cell" className="w-[96px]">
                <Stepper
                  value={x.quantity}
                  onChange={(quantity) => update.mutate({ id: x.id, quantity })}
                  label={{
                    less: fmt(h.less, { name: x.print.name }),
                    more: fmt(h.more, { name: x.print.name }),
                  }}
                />
              </View>
              <View role="cell" className="w-[96px]">
                <Tag>{condition(x)}</Tag>
              </View>
              <View role="cell" className="w-[64px]">
                <Tag>{x.language ? x.language.toUpperCase() : w.any}</Tag>
              </View>
              <Text role="cell" className="w-[112px] text-right font-mono text-sm text-ink-2">
                {wishPrice(x)}
              </Text>
              <Text
                role="cell"
                className="w-[92px] text-right font-mono text-sm font-semibold text-ink"
              >
                {current(x)}
              </Text>
              <View role="cell" className="w-[124px]">
                <Status wish={x} />
              </View>
              <View role="cell" className="w-9">
                <IconButton
                  icon="edit"
                  label={fmt(h.edit, { name: x.print.name })}
                  expanded={open}
                  onPress={() => toggle(x.id)}
                />
              </View>
            </View>
            {open && (
              <View
                role="row"
                className="border-b border-l-[3px] border-line border-l-blue bg-page p-3"
              >
                <View role="cell" className="flex-1">
                  <EditWish wish={x} onClose={() => setEditing(null)} />
                </View>
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}
