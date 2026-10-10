import type { Game } from '@voidbinder/shared';
import { createElement } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { fieldClass } from '../card/game';
import { Icon, type IconName } from '../Icon';
import { usePalette } from '../palette';
import { Segmented } from '../ui';

// Small controls of the collection screens, after docs/app/mockups/collection.html.

/** A square icon button (edit, close, sort); `label` is its accessible name. */
export function IconButton({
  icon,
  label,
  onPress,
  disabled = false,
  expanded,
  haspopup = false,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  expanded?: boolean;
  /** It opens a dialog. */
  haspopup?: boolean;
}) {
  const palette = usePalette();
  return (
    <Pressable
      role="button"
      aria-label={label}
      aria-disabled={disabled}
      disabled={disabled}
      {...(expanded !== undefined && { 'aria-expanded': expanded })}
      {...(haspopup && { 'aria-haspopup': 'dialog' as const })}
      onPress={onPress}
      className={`h-9 w-9 items-center justify-center rounded-lg ${disabled ? 'opacity-40' : ''}`}
    >
      <Icon name={icon} size={18} color={palette.ink2} />
    </Pressable>
  );
}

/** − n +, the quantity of an entry or wish; minus stops at 1 (deleting is in the form). */
export function Stepper({
  value,
  onChange,
  label,
  max = 9999,
}: {
  value: number;
  onChange: (value: number) => void;
  max?: number;
  /** Names the buttons: "{label}: eins weniger". */
  label: { less: string; more: string };
}) {
  const palette = usePalette();
  const button = 'h-8 w-8 items-center justify-center rounded-lg';
  return (
    <View className="h-9 flex-row items-center self-start rounded-xl border border-line bg-surface px-0.5">
      <Pressable
        role="button"
        aria-label={label.less}
        aria-disabled={value <= 1}
        disabled={value <= 1}
        onPress={() => onChange(value - 1)}
        className={`${button} ${value <= 1 ? 'opacity-40' : ''}`}
      >
        <Icon name="minus" size={16} color={palette.ink2} />
      </Pressable>
      <Text className="min-w-[28px] text-center font-mono text-[14px] font-semibold text-ink">
        {value}
      </Text>
      <Pressable
        role="button"
        aria-label={label.more}
        aria-disabled={value >= max}
        disabled={value >= max}
        onPress={() => onChange(value + 1)}
        className={`${button} ${value >= max ? 'opacity-40' : ''}`}
      >
        <Icon name="plus" size={16} color={palette.ink2} />
      </Pressable>
    </View>
  );
}

/** A mono tag (language, condition). */
export function Tag({ children }: { children: string }) {
  return (
    <View className="self-start rounded-md bg-surface-2 px-2 py-0.5">
      <Text className="font-mono text-[12px] font-semibold text-ink-2">{children}</Text>
    </View>
  );
}

/** The game's colour square; ink for a binder of several games. */
export function GameSquare({ game }: { game: Game | null | undefined }) {
  return (
    <View
      aria-hidden
      className={`h-2.5 w-2.5 rounded-[3px] ${game ? fieldClass[game].solid : 'bg-ink'}`}
    />
  );
}

const labelClass = 'font-display text-xs font-semibold uppercase tracking-wider text-ink-2';

/**
 * A drop-down. On the web the browser's own `<select>` (keyboard and screen readers for free); on
 * native a segmented row until the native builds get a picker (Sprint 3).
 */
export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  showLabel = true,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  /** false: the label is the accessible name only (filters). */
  showLabel?: boolean;
}) {
  if (Platform.OS !== 'web') {
    return <Segmented label={label} value={value} options={options} onChange={onChange} />;
  }
  const select = createElement(
    'select',
    {
      'aria-label': label,
      value,
      onChange: (e: { target: { value: string } }) => onChange(e.target.value as T),
      className:
        'h-10 min-w-[120px] rounded-xl border border-line bg-surface px-3 font-display text-sm font-semibold text-ink',
    },
    options.map((o) => createElement('option', { key: o.value, value: o.value }, o.label)),
  );
  return showLabel ? (
    <View className="gap-1.5">
      <Text className={labelClass}>{label}</Text>
      {select}
    </View>
  ) : (
    select
  );
}

/** The uppercase label above a form control (the mockup's `.flabel`). */
export function FieldLabel({ children }: { children: string }) {
  return <Text className={labelClass}>{children}</Text>;
}
