import { Link, type Href } from 'expo-router';
import { useId, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { ApiError } from '../api/queries/http';
import { CC_BY_SA_URL, YUGIPEDIA_ATTRIBUTION, YUGIPEDIA_URL } from '@voidbinder/shared/notices';
import { useLocale, useT } from '../i18n';
import { Icon } from './Icon';
import { usePalette } from './palette';

// react-native-web passes keyboard events through; the React Native types do not list them.
type WebKey = {
  key: string;
  preventDefault: () => void;
  currentTarget: { parentElement: { children: ArrayLike<{ focus: () => void }> } | null };
};
const onKey = (handler: (e: WebKey) => void) =>
  ({ onKeyDown: handler }) as unknown as Record<string, never>;

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

/**
 * Yugipedia's attribution with the source and the licence linked (CC BY-SA 4.0, VB-93), in the
 * footer and on a Yu-Gi-Oh! card page.
 */
export function YugipediaCredit({ className }: { className: string }) {
  const locale = useLocale();
  const [lead] = YUGIPEDIA_ATTRIBUTION[locale].split('Yugipedia');
  const link = 'underline';
  return (
    <Text className={className}>
      {lead}
      <Link href={YUGIPEDIA_URL} className={link}>
        Yugipedia
      </Link>{' '}
      (
      <Link href={CC_BY_SA_URL} className={link}>
        CC BY-SA 4.0
      </Link>
      )
    </Text>
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
  // The hint or error is the input's description (aria-describedby on web, ignored natively).
  const noteId = `${useId()}-note`;
  const described = error || hint ? ({ 'aria-describedby': noteId } as object) : {};
  return (
    <View className="gap-1.5">
      <Text className="font-display text-xs font-semibold uppercase tracking-wider text-ink-2">
        {label}
      </Text>
      <TextInput
        aria-label={label}
        aria-invalid={!!error}
        {...described}
        placeholderTextColor={palette.ink3}
        className={`h-11 rounded-xl border bg-surface px-3 font-body text-[15px] text-ink ${error ? 'border-ink' : 'border-line'}`}
        {...input}
      />
      {error ? (
        <Text nativeID={noteId} role="alert" className="font-body text-sm text-ink">
          {error}
        </Text>
      ) : hint ? (
        <Text nativeID={noteId} className="font-body text-sm text-ink-3">
          {hint}
        </Text>
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
        {...onKey((e) => {
          if (e.key !== ' ') return;
          e.preventDefault();
          onChange(!checked);
        })}
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

/** A segmented radio group (language, currency). An option's `name` is its accessible name when the visible label is short ("DE"). */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string; name?: string }[];
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
        className="flex-row flex-wrap gap-1 self-start rounded-xl bg-surface-2 p-1"
      >
        {options.map((o, i) => (
          <Pressable
            key={o.value}
            role="radio"
            {...(o.name && { 'aria-label': o.name })}
            aria-checked={o.value === value}
            // Roving focus: only the checked radio is a tab stop, arrows move the selection.
            tabIndex={o.value === value ? 0 : -1}
            onPress={() => onChange(o.value)}
            {...onKey((e) => {
              const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
              if (e.key === ' ') {
                e.preventDefault();
                onChange(o.value);
              } else if (step) {
                e.preventDefault();
                const at = (i + step + options.length) % options.length;
                const next = options[at];
                if (next) onChange(next.value);
                e.currentTarget.parentElement?.children[at]?.focus();
              }
            })}
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
