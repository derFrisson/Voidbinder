import { useEffect, useSyncExternalStore } from 'react';
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

export function showToast(toast: Toast) {
  current = { ...toast, key: ++count };
  emit();
}

export function hideToast() {
  current = null;
  emit();
}

/** The toast at the bottom (above the phone's tab bar); it goes after 6 s or on its action. */
export function Toaster() {
  const toast = useSyncExternalStore(subscribe, read, read);
  const wide = useWindowDimensions().width >= 768;
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(hideToast, 6000);
    return () => clearTimeout(timer);
  }, [toast]);
  const action = toast?.action;
  return (
    // The live region is always there, so a screen reader announces the text when it appears.
    <View
      role="status"
      className={`absolute ${wide ? 'bottom-6 right-6 max-w-[420px]' : 'inset-x-4 bottom-24'}`}
    >
      {toast && (
        <View className="flex-row items-center gap-3 rounded-xl bg-ink py-2 pl-4 pr-2">
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
      )}
    </View>
  );
}
