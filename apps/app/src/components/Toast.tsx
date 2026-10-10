import { useEffect, useState, useSyncExternalStore } from 'react';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';

// One toast at a time for the whole app ("Als DE · Holo · NM hinzugefügt · Ändern"). A tiny store
// instead of a context: `showToast` works from any handler, `Toaster` in the Shell shows it.

export type Toast = { text: string; action?: { label: string; onPress: () => void } | undefined };

let current: (Toast & { key: number }) | null = null;
let count = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
const read = () => current;

/** Shows the toast and returns its key, so its owner can take exactly this one down again. */
export function showToast(toast: Toast) {
  current = { ...toast, key: ++count };
  emit();
  return current.key;
}

/** With a `key`, hides only that toast: a later one, from somewhere else, stays. */
export function hideToast(key?: number) {
  if (key !== undefined && current?.key !== key) return;
  current = null;
  emit();
}

/**
 * The toast at the bottom (above the phone's tab bar); it goes after 6 s or on its action. The
 * 6 s stand still while the pointer is over it or focus is inside it (WCAG 2.2.1), so the action
 * cannot vanish under a keyboard or screen reader user, and start again when both are gone.
 */
export function Toaster() {
  const toast = useSyncExternalStore(subscribe, read, read);
  const wide = useWindowDimensions().width >= 768;
  return (
    // The live region is always there, so a screen reader announces the text when it appears.
    <View
      role="status"
      className={`absolute ${wide ? 'bottom-6 right-6 max-w-[420px]' : 'inset-x-4 bottom-24'}`}
    >
      {toast && <ToastBody key={toast.key} toast={toast} />}
    </View>
  );
}

// One component per toast (keyed), so the hover and focus state goes with it.
function ToastBody({ toast }: { toast: Toast }) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const held = hover || focus;
  useEffect(() => {
    if (held) return;
    const timer = setTimeout(() => hideToast(), 6000);
    return () => clearTimeout(timer);
  }, [held]);
  const action = toast.action;
  return (
    <View
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      className="flex-row items-center gap-3 rounded-xl bg-ink py-2 pl-4 pr-2"
    >
      <Text className="flex-1 py-1 font-body text-sm text-page">{toast.text}</Text>
      {action && (
        <Pressable
          role="button"
          onPress={() => {
            hideToast();
            action.onPress();
          }}
          className="h-9 justify-center rounded-lg px-3"
        >
          <Text className="font-display text-sm font-semibold text-page underline">
            {action.label}
          </Text>
        </Pressable>
      )}
    </View>
  );
}
