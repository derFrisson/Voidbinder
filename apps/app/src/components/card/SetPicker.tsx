import type { Game } from '@voidbinder/shared';
import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSets } from '../../api/queries/catalog';
import { useLocale, useT } from '../../i18n';
import { usePalette } from '../palette';
import { Chip } from './Chip';

/** The set filter: a chip that opens the game's sets, newest first, with a text filter. */
export function SetPicker({
  game,
  value,
  onChange,
}: {
  game: Game;
  value: string | undefined;
  onChange: (code: string | undefined) => void;
}) {
  const t = useT();
  const palette = usePalette();
  const sets = useSets(game, useLocale());
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const list = sets.data?.sets ?? [];
  const selected = list.find((s) => s.code === value);
  const f = filter.trim().toLowerCase();
  const matches = list
    .filter(
      (s) =>
        !f ||
        s.code.includes(f) ||
        s.name.toLowerCase().includes(f) ||
        s.localizedName?.toLowerCase().includes(f),
    )
    // ponytail: the first 50 matches; the text filter narrows the rest (Magic has ~800 sets).
    .slice(0, 50);
  const pick = (code: string | undefined) => {
    onChange(code);
    setOpen(false);
    setFilter('');
  };
  const row = 'flex-row items-baseline gap-3 rounded-lg px-2.5 py-2';
  return (
    <View className="gap-2">
      <Chip
        label={
          value
            ? `${t.search.set}: ${selected?.localizedName ?? selected?.name ?? value.toUpperCase()}`
            : t.search.allSets
        }
        pressed={!!value}
        onPress={() => setOpen(!open)}
      />
      {open && (
        <View className="w-full max-w-[440px] gap-2 rounded-xl border border-line bg-surface p-2">
          <TextInput
            value={filter}
            onChangeText={setFilter}
            autoFocus
            placeholder={t.search.findSet}
            aria-label={t.search.findSet}
            placeholderTextColor={palette.ink3}
            className="h-10 rounded-lg border border-line bg-surface px-3 font-body text-sm text-ink"
          />
          <ScrollView className="max-h-72">
            <Pressable role="button" onPress={() => pick(undefined)} className={row}>
              <Text className="font-body text-sm font-semibold text-ink">{t.search.allSets}</Text>
            </Pressable>
            {matches.map((s) => (
              <Pressable
                key={s.code}
                role="button"
                aria-pressed={s.code === value}
                onPress={() => pick(s.code)}
                className={`${row} ${s.code === value ? 'bg-surface-2' : ''}`}
              >
                <Text className="w-16 font-mono text-xs text-ink-2">{s.code.toUpperCase()}</Text>
                <Text numberOfLines={1} className="flex-1 font-body text-sm text-ink">
                  {s.localizedName ?? s.name}
                </Text>
                <Text className="font-mono text-xs text-ink-3">{s.releasedOn?.slice(0, 4)}</Text>
              </Pressable>
            ))}
            {sets.isSuccess && !matches.length && (
              <Text className="px-2.5 py-2 font-body text-sm text-ink-2">{t.search.noSet}</Text>
            )}
          </ScrollView>
        </View>
      )}
    </View>
  );
}
