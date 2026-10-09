import './fetch';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Native modules and the router are replaced: the tests cover the app's own logic, and the
// router is exercised end to end in test/web.test.ts.
vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'de' }] }));
vi.mock('expo-font', () => ({ useFonts: () => [true] }));
vi.mock('react-native-svg', () => {
  const Svg = ({ children }: { children?: import('react').ReactNode }) => children ?? null;
  return { default: Svg, Svg, Circle: () => null, G: Svg, Path: () => null, Rect: () => null };
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
    Link: ({ href, children }: { href: unknown; children?: Node }) =>
      createElement(
        'a',
        { href: typeof href === 'string' ? href : JSON.stringify(href) },
        children,
      ),
    Redirect: ({ href }: { href: unknown }) =>
      createElement('output', { 'data-testid': 'redirect' }, JSON.stringify(href)),
    Slot: () => null,
  };
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});
