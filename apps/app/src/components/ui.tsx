import { Link, type Href } from 'expo-router';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { ApiError } from '../api/queries/http';
import { useT } from '../i18n';
import { Icon } from './Icon';
import { usePalette } from './palette';

// The app's few controls, styled after the mockups (docs/app/mockups): blue is the only action
// colour, 12 px radii, Sora for labels.

const buttonClass = {
  primary: 'bg-blue',
  ghost: 'bg-surface border border-line',
  danger: 'bg-surface border border-ink-3',
} as const;
const buttonText = { primary: 'text-on-blue', ghost: 'text-ink', danger: 'text-ink' } as const;

export function Button({
  label,
  onPress,
  variant = 'primary',
  busy = false,
  disabled = false,
  wide = false,
}: {
  label: string;
  onPress: () => void;
  variant?: keyof typeof buttonClass;
  busy?: boolean;
  disabled?: boolean;
  wide?: boolean;
}) {
  const palette = usePalette();
  const off = disabled || busy;
  return (
    <Pressable
      role="button"
      aria-disabled={off}
      aria-busy={busy}
      disabled={off}
      onPress={onPress}
      className={`h-11 flex-row items-center justify-center gap-2 rounded-xl px-4 ${buttonClass[variant]} ${off ? 'opacity-60' : ''} ${wide ? 'w-full' : 'self-start'}`}
    >
      {busy && (
        <ActivityIndicator
          size="small"
          color={variant === 'primary' ? palette.onBlue : palette.ink}
        />
      )}
      <Text className={`font-display text-[15px] font-semibold ${buttonText[variant]}`}>
        {label}
      </Text>
    </Pressable>
  );
}

/** An in-app link (blue text) or, with an `https:` href, an external one. */
export function TextLink({ href, children }: { href: Href; children: ReactNode }) {
  return (
    <Link href={href} className="font-body font-semibold text-blue-ink underline">
      {children}
    </Link>
  );
}

export function Field({
  label,
  hint,
  error,
  ...input
}: { label: string; hint?: string; error?: string | undefined } & TextInputProps) {
  const palette = usePalette();
  return (
    <View className="gap-1.5">
      <Text className="font-display text-xs font-semibold uppercase tracking-wider text-ink-2">
        {label}
      </Text>
      <TextInput
        aria-label={label}
        aria-invalid={!!error}
        placeholderTextColor={palette.ink3}
        className={`h-11 rounded-xl border bg-surface px-3 font-body text-[15px] text-ink ${error ? 'border-ink' : 'border-line'}`}
        {...input}
      />
      {error ? (
        <Text role="alert" className="font-body text-sm text-ink">
          {error}
        </Text>
      ) : hint ? (
        <Text className="font-body text-sm text-ink-3">{hint}</Text>
      ) : null}
    </View>
  );
}

export function Checkbox({
  checked,
  onChange,
  children,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** The visible text; `label` is the accessible name when the text holds a link. */
  children: ReactNode;
  label: string;
}) {
  const palette = usePalette();
  return (
    <View className="flex-row items-start gap-3">
      <Pressable
        role="checkbox"
        aria-checked={checked}
        aria-label={label}
        onPress={() => onChange(!checked)}
        className={`mt-0.5 h-6 w-6 items-center justify-center rounded-md border-2 ${checked ? 'border-blue bg-blue' : 'border-ink-3 bg-surface'}`}
      >
        {checked && <Icon name="check" size={16} color={palette.onBlue} />}
      </Pressable>
      <Text
        className="flex-1 font-body text-[15px] leading-6 text-ink-2"
        onPress={() => onChange(!checked)}
      >
        {children}
      </Text>
    </View>
  );
}

/** A segmented radio group (language, currency). */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View className="gap-1.5">
      <Text className="font-display text-xs font-semibold uppercase tracking-wider text-ink-2">
        {label}
      </Text>
      <View
        role="radiogroup"
        aria-label={label}
        className="flex-row gap-1 self-start rounded-xl bg-surface-2 p-1"
      >
        {options.map((o) => (
          <Pressable
            key={o.value}
            role="radio"
            aria-checked={o.value === value}
            onPress={() => onChange(o.value)}
            className={`h-9 justify-center rounded-lg px-4 ${o.value === value ? 'bg-surface border border-line' : ''}`}
          >
            <Text
              className={`font-display text-sm font-semibold ${o.value === value ? 'text-ink' : 'text-ink-2'}`}
            >
              {o.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/** A panel on the surface, the mockups' card. */
export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <View className={`gap-4 rounded-2xl border border-line bg-surface p-5 ${className}`}>
      {children}
    </View>
  );
}

/**
 * A status line under a form: the result of the last action. The error tint is the same in both
 * schemes, so its text is `phone` (near-black in both), not `ink`, which turns light in dark mode.
 */
export function Note({
  children,
  tone = 'info',
}: {
  children: ReactNode;
  tone?: 'info' | 'error';
}) {
  return (
    <View
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-xl px-4 py-3 ${tone === 'error' ? 'bg-error' : 'bg-blue-soft'}`}
    >
      <Text
        className={`font-body text-[15px] leading-6 ${tone === 'error' ? 'text-phone' : 'text-ink'}`}
      >
        {children}
      </Text>
    </View>
  );
}

export function Loading() {
  const t = useT();
  const palette = usePalette();
  return (
    <View role="status" className="flex-row items-center gap-3 py-8">
      <ActivityIndicator color={palette.ink3} />
      <Text className="font-body text-ink-2">{t.state.loading}</Text>
    </View>
  );
}

export function ErrorState({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  return (
    <View className="gap-4 py-8">
      <Note tone="error">{t.state.error}</Note>
      <Button variant="ghost" label={t.state.retry} onPress={onRetry} />
    </View>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <View className="rounded-2xl border border-dashed border-line px-5 py-8">
      <Text className="font-body text-[15px] text-ink-2">{children}</Text>
    </View>
  );
}

/**
 * Loading, error and empty states of a query in one place; `children` renders the data.
 * The screens VB-56, VB-35, VB-31 and VB-34 fill use it until they get their final UI.
 */
export function QueryState<T>({
  query,
  isEmpty,
  empty,
  children,
}: {
  query: {
    data: T | undefined;
    error: Error | null;
    isPending: boolean;
    refetch: () => unknown;
  };
  isEmpty?: (data: T) => boolean;
  empty?: string;
  children: (data: T) => ReactNode;
}) {
  const t = useT();
  if (query.isPending) return <Loading />;
  // A malformed id or an unknown set answers 400 or 404; asking again does not help.
  if (
    query.error instanceof ApiError &&
    (query.error.status === 404 || query.error.status === 400)
  ) {
    return <Empty>{t.state.notFound}</Empty>;
  }
  if (query.error || query.data === undefined)
    return <ErrorState onRetry={() => void query.refetch()} />;
  if (isEmpty?.(query.data) && empty) return <Empty>{empty}</Empty>;
  return <>{children(query.data)}</>;
}
