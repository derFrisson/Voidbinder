import './fetch';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { turnstileFake } from './turnstile';

// Native modules and the router are replaced: the tests cover the app's own logic, and the
// router is exercised end to end in test/web.test.ts.
vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'de' }] }));
vi.mock('expo-font', () => ({ useFonts: () => [true] }));
vi.mock('react-native-svg', () => {
  const Svg = ({ children }: { children?: import('react').ReactNode }) => children ?? null;
  const none = () => null;
  return {
    default: Svg,
    Svg,
    Circle: none,
    Defs: none,
    G: Svg,
    Path: none,
    Pattern: none,
    Polyline: none,
    Rect: none,
  };
});
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock('expo-router', async () => {
  const { createElement } = await import('react');
  type Node = import('react').ReactNode;
  return {
    router: { replace: vi.fn(), push: vi.fn(), back: vi.fn(), canGoBack: () => false },
    useLocalSearchParams: vi.fn(() => ({})),
    usePathname: vi.fn(() => '/'),
    useGlobalSearchParams: vi.fn(() => ({})),
    // `target` and `rel` reach the anchor, as the web Link passes them (hrefAttrs).
    Link: ({
      href,
      target,
      rel,
      children,
    }: {
      href: unknown;
      target?: string;
      rel?: string;
      children?: Node;
    }) =>
      createElement(
        'a',
        { href: typeof href === 'string' ? href : JSON.stringify(href), target, rel },
        children,
      ),
    Redirect: ({ href }: { href: unknown }) =>
      createElement('output', { 'data-testid': 'redirect' }, JSON.stringify(href)),
    Slot: () => null,
  };
});

// jsdom has no layout, so react-native-web never calls `onLayout`: this observer reports the
// width in `turnstileFake.boxWidth` for every element that has a handler, at once on observe().
window.ResizeObserver = class {
  observe(node: Element) {
    const handler = (node as unknown as Record<string, unknown>).__reactLayoutHandler;
    if (typeof handler !== 'function') return;
    const layout = { x: 0, y: 0, width: turnstileFake.boxWidth, height: 0, left: 0, top: 0 };
    handler({ nativeEvent: { layout }, timeStamp: Date.now() });
  }
  unobserve() {}
  disconnect() {}
};

beforeEach(() => turnstileFake.install());

afterEach(() => {
  cleanup();
  localStorage.clear();
  delete window.turnstile;
});
