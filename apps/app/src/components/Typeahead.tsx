import { cardAspect, isFoil } from '@voidbinder/shared';
import type { SearchSuggestion } from '@voidbinder/shared/api';
import { router } from 'expo-router';
import { useEffect, useId, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  Text,
  View,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from 'react-native';
import { searchable, useSuggest } from '../api/queries/search';
import { hitHref } from '../hooks/browsing-language';
import { fmt, useLocale, useT } from '../i18n';
import { label } from './card/attributes';
import { fieldClass } from './card/game';
import { CardImage } from './catalog/CardImage';
import { Icon } from './Icon';
import { usePalette } from './palette';

const DEBOUNCE_MS = 150;

/** `value` once it has stayed the same for `ms`. */
function useDebounced(value: string, ms: number) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/**
 * Where a suggestion leads: a print to its card page, in the language it matched unless that is
 * `locale` (VB-102); a set to the set page.
 */
export function suggestionHref(s: SearchSuggestion, locale: string) {
  return s.kind === 'print' && s.cardId
    ? hitHref({ ...s, cardId: s.cardId }, locale)
    : `/${s.game}/sets/${s.set.code}`;
}

/** The magnifier, or a spinner of the same size while suggestions load (no layout shift). */
export function SearchLead({ busy, size }: { busy: boolean; size: number }) {
  const palette = usePalette();
  return (
    <View aria-hidden className="items-center justify-center" style={{ width: size, height: size }}>
      {busy ? (
        <ActivityIndicator size={size} color={palette.ink3} />
      ) : (
        <Icon name="search" size={size} color={palette.ink3} />
      )}
    </View>
  );
}

/** The code in front of a print's number, unless the number already starts with it (Yu-Gi-Oh!). */
function printLabel(s: SearchSuggestion, code: string) {
  if (s.kind === 'set') return code;
  const number = s.displayNumber ?? s.number ?? '';
  return number.toUpperCase().startsWith(code) ? number : `${code} ${number}`.trim();
}

function Row({
  s,
  id,
  active,
  onHover,
  onPress,
}: {
  s: SearchSuggestion;
  id: string;
  active: boolean;
  onHover: () => void;
  onPress: () => void;
}) {
  const t = useT();
  const code = s.set.code.toUpperCase();
  const detail =
    s.kind === 'set'
      ? `${t.search.set} · ${t.games[s.game]}`
      : [
          s.rarity && label(t.card.rarities, s.rarity),
          s.extendedArt && t.set.extendedArt,
          s.set.name,
        ]
          .filter(Boolean)
          .join(' · ');
  return (
    <Pressable
      nativeID={id}
      role="option"
      aria-selected={active}
      focusable={false}
      onHoverIn={onHover}
      onPress={onPress}
      className={`min-h-[56px] flex-row items-center gap-3 px-3 py-1.5 ${active ? 'bg-blue-soft' : ''}`}
    >
      <View className="w-8">
        {s.kind === 'set' ? (
          <View
            style={{ aspectRatio: cardAspect() }}
            className={`w-full items-center justify-center rounded-md ${fieldClass[s.game].soft}`}
          >
            <View className={`h-2.5 w-2.5 rounded-[3px] ${fieldClass[s.game].solid}`} />
          </View>
        ) : (
          <CardImage
            uri={s.imageUrl ?? null}
            alt=""
            game={s.game}
            format={s.cardFormat ?? 'standard'}
            foil={isFoil(s.game, s.rarity, undefined, s.extendedArt)}
            className="rounded-md border"
          />
        )}
      </View>
      <View className="min-w-0 flex-1 gap-0.5">
        <Text numberOfLines={1} className="font-display text-sm font-semibold text-ink">
          {s.name}
        </Text>
        <Text numberOfLines={1} className="font-body text-xs text-ink-2">
          <Text className="font-mono">{printLabel(s, code)}</Text>
          {detail ? ` · ${detail}` : ''}
        </Text>
      </View>
    </Pressable>
  );
}

type KeyPress = NativeSyntheticEvent<TextInputKeyPressEventData>;

/**
 * The search box's typeahead on the web (VB-79), an ARIA 1.2 combobox: suggestions 150 ms after
 * the last keystroke from two characters on, ArrowUp/Down to highlight, Enter opens the
 * highlighted row (without one the box submits as before), Esc and leaving the box close it. A
 * failed request closes it silently. Native gets the plain input (`inputProps` is only the change
 * handler, `list` and `live` are null).
 *
 * `list` goes inside the box's `relative` parent (it hangs below it, `listClass` positions it);
 * `live` anywhere next to it (the count for screen readers).
 */
export function useTypeahead({
  text,
  onChangeText,
  listClass = 'left-0 right-0',
  enabled = true,
}: {
  text: string;
  onChangeText: (text: string) => void;
  listClass?: string;
  enabled?: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const web = Platform.OS === 'web' && enabled;
  const listId = `${useId()}-suggestions`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const settled = useDebounced(text.trim(), DEBOUNCE_MS);
  const suggest = useSuggest(settled, locale, web);
  // The rows answer this text (not the previous one's, kept while the next query loads).
  const fresh = settled === text.trim() && !suggest.isPlaceholderData;
  const items = suggest.data?.suggestions ?? [];
  // New suggestions start without a highlight.
  useEffect(() => setActive(-1), [suggest.data]);

  // Like the rows, an empty answer stays until the next answer replaces it (no flicker).
  const answered = web && open && searchable(text) && !!suggest.data && !suggest.isError;
  const expanded = answered && items.length > 0;
  const none = answered && items.length === 0;

  const close = () => {
    setOpen(false);
    setActive(-1);
  };
  const go = (s: SearchSuggestion) => {
    close();
    router.push(suggestionHref(s, locale));
  };
  const onKeyPress = (e: KeyPress) => {
    const key = e.nativeEvent.key;
    if (key === 'Escape') return close();
    if (key === 'ArrowDown' && !open) return setOpen(true);
    // Stale rows can't be picked: Enter submits the box as typed, the arrows wait for the answer.
    if (!expanded) return;
    if (!fresh) return key === 'Enter' ? close() : undefined;
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      e.preventDefault();
      const n = items.length;
      setActive((a) => (key === 'ArrowDown' ? (a + 1) % n : a <= 0 ? n - 1 : a - 1));
    } else if (key === 'Enter') {
      const s = items[active];
      // Without a highlight the box submits (the results page); preventing it stops the submit.
      if (!s) return close();
      e.preventDefault();
      go(s);
    }
  };

  const inputProps = web
    ? {
        role: 'combobox' as const,
        autoComplete: 'off' as const,
        'aria-expanded': expanded,
        onChangeText: (value: string) => {
          setOpen(true);
          setActive(-1);
          onChangeText(value);
        },
        onKeyPress,
        onBlur: close,
        ...({
          'aria-autocomplete': 'list',
          'aria-controls': expanded ? listId : undefined,
          'aria-activedescendant': expanded && active >= 0 ? `${listId}-${active}` : undefined,
        } as object),
      }
    : { onChangeText };

  const panel = `absolute top-full z-10 mt-1.5 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-lg ${listClass}`;
  // Pressing a row must not blur the box first (that would close the list before the press).
  const keepFocus = {
    onMouseDown: (e: { preventDefault(): void }) => e.preventDefault(),
  } as object;
  let list: ReactNode = null;
  if (expanded) {
    list = (
      <View
        nativeID={listId}
        // react-native's Role has no listbox; react-native-web passes it through.
        {...({ role: 'listbox' } as object)}
        aria-label={t.top.suggestions}
        {...keepFocus}
        className={panel}
      >
        {items.map((s, i) => (
          <Row
            key={`${s.kind}:${s.id}`}
            s={s}
            id={`${listId}-${i}`}
            active={i === active}
            onHover={() => setActive(i)}
            onPress={() => go(s)}
          />
        ))}
      </View>
    );
  } else if (none) {
    list = (
      <View {...keepFocus} className={panel}>
        <Text className="px-3 py-2.5 font-body text-sm text-ink-3">{t.top.suggestNone}</Text>
      </View>
    );
  }

  const count =
    items.length === 1 ? t.top.suggestOne : fmt(t.top.suggestCount, { count: items.length });
  const live = web ? (
    <Text role="status" testID="typeahead-status" className="sr-only">
      {expanded ? count : none ? t.top.suggestNone : ''}
    </Text>
  ) : null;

  return { inputProps, busy: web && suggest.isFetching, list, live };
}
