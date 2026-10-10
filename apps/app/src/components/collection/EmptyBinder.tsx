import type { Binder } from '@voidbinder/shared/api';
import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { useDeleteBinder } from '../../api/queries/collection';
import { fmt, useT } from '../../i18n';
import { fieldClass } from '../card/game';
import { useWide } from '../Shell';
import { Button } from '../ui';

/** A binder page of 3 × 3 empty pockets, the middle one tinted in the binder's game colour. */
function Pockets({ binder }: { binder: Binder }) {
  return (
    <View
      aria-hidden
      className="w-[204px] flex-row flex-wrap gap-2 self-center rounded-2xl bg-surface-2 p-3"
    >
      {Array.from({ length: 9 }, (_, i) => (
        <View
          key={i}
          className={`h-[78px] w-[54px] rounded-md border border-dashed border-line ${i === 4 && binder.game ? fieldClass[binder.game].soft : 'bg-surface'}`}
        />
      ))}
    </View>
  );
}

/** "„Neue Mappe Oktober“ ist noch leer": add cards from the search, move entries in, or delete. */
export function EmptyBinder({ binder, onShowAll }: { binder: Binder; onShowAll: () => void }) {
  const t = useT();
  const wide = useWide();
  const remove = useDeleteBinder();
  const [confirming, setConfirming] = useState(false);
  const e = t.collection.emptyBinder;
  return (
    <View
      className={`rounded-2xl border border-line bg-surface p-6 ${wide ? 'flex-row items-center gap-10' : 'gap-6'}`}
    >
      <Pockets binder={binder} />
      <View className="min-w-0 flex-1 gap-3">
        <Text
          role="heading"
          aria-level={2}
          className="font-display text-2xl font-bold tracking-tight text-ink"
        >
          {fmt(e.title, { name: binder.name })}
        </Text>
        <Text className="max-w-[520px] font-body text-[15px] leading-6 text-ink-2">{e.body}</Text>
        <View className="flex-row flex-wrap gap-2 pt-1">
          <Button
            label={t.collection.addCards}
            onPress={() => router.push({ pathname: '/search', params: { binder: binder.id } })}
          />
          <Button variant="ghost" label={e.move} onPress={onShowAll} />
          {confirming ? (
            <Button
              variant="danger"
              label={t.collection.edit.confirm}
              busy={remove.isPending}
              onPress={() => remove.mutate(binder.id, { onSuccess: onShowAll })}
            />
          ) : (
            <Button variant="ghost" label={e.delete} onPress={() => setConfirming(true)} />
          )}
        </View>
      </View>
    </View>
  );
}
