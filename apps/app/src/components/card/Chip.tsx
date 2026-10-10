import { Pressable, Text } from 'react-native';

/** A filter chip (docs/app/mockups): pressed is ink on light, a toggle button for assistive tech. */
export function Chip({
  label,
  pressed,
  onPress,
}: {
  label: string;
  pressed: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      role="button"
      aria-pressed={pressed}
      onPress={onPress}
      className={`h-8 flex-row items-center rounded-full px-3.5 ${pressed ? 'bg-ink' : 'border border-line bg-surface'}`}
    >
      <Text
        className={`font-display text-[13px] font-semibold ${pressed ? 'text-page' : 'text-ink-2'}`}
      >
        {label}
      </Text>
    </Pressable>
  );
}
