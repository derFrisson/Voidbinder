import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { router } from 'expo-router';
import { Text } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, json, renderApp, type Call } from '../../test/fake-api';
import { Shell, Page } from './Shell';
import { SearchLead } from './Typeahead';

// The top bar (and its search box) shows from 768 px; jsdom is 0 px wide.
vi.mock('react-native', async (orig) => ({
  ...(await orig<typeof import('react-native')>()),
  useWindowDimensions: () => ({ width: 1200, height: 800, scale: 1, fontScale: 1 }),
}));

const CARD = '10000000-0000-4000-8000-000000000001';
const PRINT = '00000000-0000-4000-8000-000000000001';
const SET = '00000000-0000-4000-8000-000000000002';
const suggestions = [
  {
    kind: 'print',
    id: PRINT,
    name: 'Dunkler Magier',
    game: 'yugioh',
    set: { code: 'lds3', name: 'Legendary Duelists: Season 3' },
    number: 'LDS3-EN121',
    rarity: 'Ultra Rare',
    imageUrl: null,
    cardId: CARD,
  },
  {
    kind: 'set',
    id: SET,
    name: 'Legendary Duelists: Season 3',
    game: 'yugioh',
    set: { code: 'lds3', name: 'Legendary Duelists: Season 3' },
  },
];

const suggestCalls = (calls: Call[]) =>
  calls.filter((c) => c.path.startsWith('/catalog/search/suggest'));

function answer(body: unknown = { suggestions }, status = 200) {
  return fakeApi((c) =>
    c.path.startsWith('/catalog/search/suggest') ? json(body, status) : undefined,
  );
}

function shell() {
  renderApp(
    <Shell>
      <Page title="Seite">
        <Text>page</Text>
      </Page>
    </Shell>,
  );
  return screen.getByRole('combobox', { name: 'Karte, Set oder Nummer suchen' });
}

const type = (box: HTMLElement, value: string) => fireEvent.change(box, { target: { value } });
const key = (box: HTMLElement, k: string) => fireEvent.keyDown(box, { key: k });

beforeEach(() => vi.mocked(router.push).mockClear());

describe('search typeahead (VB-79)', () => {
  afterEach(() => vi.useRealTimers());

  it('draws the spinner exactly as big as the magnifier box', () => {
    renderApp(<SearchLead busy size={18} />);
    const spinner = screen.getByRole('progressbar', { hidden: true });
    const drawn = spinner.firstElementChild as HTMLElement;
    expect([drawn.style.width, drawn.style.height]).toEqual(['18px', '18px']);
  });

  it('asks once, 150 ms after the last keystroke, from two characters on', async () => {
    vi.useFakeTimers();
    const calls = answer();
    const box = shell();
    type(box, 'l');
    await act(() => vi.advanceTimersByTimeAsync(300));
    type(box, 'ld');
    await act(() => vi.advanceTimersByTimeAsync(100));
    type(box, 'lds');
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(suggestCalls(calls)).toEqual([]);
    await act(() => vi.advanceTimersByTimeAsync(60));
    vi.useRealTimers();
    await waitFor(() => expect(suggestCalls(calls)).toHaveLength(1));
    expect(suggestCalls(calls)[0]?.path).toBe('/catalog/search/suggest?q=lds&lang=de&names=all');
  });

  it('shows the suggestions as a listbox the box controls and announces their count', async () => {
    answer();
    const box = shell();
    expect(box.getAttribute('aria-expanded')).toBe('false');
    type(box, 'lds3');
    const list = await screen.findByRole('listbox', { name: 'Vorschläge' });
    expect(box.getAttribute('aria-expanded')).toBe('true');
    expect(box.getAttribute('aria-controls')).toBe(list.id);
    expect(box.getAttribute('aria-autocomplete')).toBe('list');
    const options = within(list).getAllByRole('option');
    expect(options).toHaveLength(2);
    expect(options[0]?.textContent).toContain('Dunkler Magier');
    // The number already starts with the set code: no "LDS3 LDS3-EN121".
    expect(options[0]?.textContent).toContain('LDS3-EN121 · Ultra Rare');
    expect(options[0]?.textContent).not.toContain('LDS3 LDS3');
    expect(options[0]?.textContent).toContain('Ultra Rare');
    // The print without a picture shows its number in the frame; the set row is styled as a set.
    expect(options[1]?.textContent).toContain('LDS3 · Set · Yu‑Gi‑Oh!');
    expect(screen.getByTestId('typeahead-status').textContent).toBe('2 Vorschläge');
  });

  it('moves the highlight with the arrow keys and opens the highlighted row with Enter', async () => {
    answer();
    const box = shell();
    type(box, 'lds3');
    const list = await screen.findByRole('listbox');
    const options = within(list).getAllByRole('option');
    expect(box.getAttribute('aria-activedescendant')).toBeNull();
    key(box, 'ArrowDown');
    expect(box.getAttribute('aria-activedescendant')).toBe(options[0]?.id);
    expect(options[0]?.getAttribute('aria-selected')).toBe('true');
    key(box, 'ArrowDown');
    expect(box.getAttribute('aria-activedescendant')).toBe(options[1]?.id);
    key(box, 'ArrowDown');
    expect(box.getAttribute('aria-activedescendant')).toBe(options[0]?.id);
    key(box, 'ArrowUp');
    expect(box.getAttribute('aria-activedescendant')).toBe(options[1]?.id);
    key(box, 'Enter');
    expect(router.push).toHaveBeenCalledWith('/yugioh/sets/lds3');
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('listbox')).toBeNull();

    type(box, 'lds3 ');
    await screen.findByRole('listbox');
    key(box, 'ArrowUp');
    key(box, 'ArrowUp');
    key(box, 'Enter');
    expect(router.push).toHaveBeenLastCalledWith(`/cards/${CARD}?print=${PRINT}`);
  });

  it('opens a row on click', async () => {
    answer();
    const box = shell();
    type(box, 'lds3');
    const list = await screen.findByRole('listbox');
    fireEvent.click(within(list).getByRole('option', { name: /Dunkler Magier/ }));
    expect(router.push).toHaveBeenCalledWith(`/cards/${CARD}?print=${PRINT}`);
  });

  it('does not pick a row of the previous text while the next answer is pending', async () => {
    answer();
    const box = shell();
    type(box, 'lds3');
    await screen.findByRole('listbox');
    type(box, 'lds');
    // Within the debounce the rows still show but belong to "lds3": no highlight, Enter submits "lds".
    key(box, 'ArrowDown');
    expect(box.getAttribute('aria-activedescendant')).toBeNull();
    key(box, 'Enter');
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith({ pathname: '/search', params: { q: 'lds' } });
  });

  it('closes on Escape and on leaving the box', async () => {
    answer();
    const box = shell();
    type(box, 'lds3');
    await screen.findByRole('listbox');
    key(box, 'Escape');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(box.getAttribute('aria-expanded')).toBe('false');
    expect(box.getAttribute('aria-controls')).toBeNull();
    key(box, 'ArrowDown');
    await screen.findByRole('listbox');
    fireEvent.blur(box);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('submits to the results page with Enter and no highlight', async () => {
    answer();
    const box = shell();
    type(box, 'lds3');
    await screen.findByRole('listbox');
    key(box, 'Enter');
    expect(router.push).toHaveBeenCalledWith({ pathname: '/search', params: { q: 'lds3' } });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('says "Keine Treffer" once the answer is empty', async () => {
    answer({ suggestions: [] });
    const box = shell();
    type(box, 'zzzz');
    await screen.findByText('Keine Treffer', { selector: 'div:not([role=status])' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(box.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByTestId('typeahead-status').textContent).toBe('Keine Treffer');
  });

  it('keeps "Keine Treffer" steady while the next keystroke is still being answered', async () => {
    // The API takes 100 ms to answer, so the debounce and the load both show on the clock.
    const calls = fakeApi((c) =>
      c.path.startsWith('/catalog/search/suggest')
        ? new Response(
            new ReadableStream({
              start(controller) {
                setTimeout(() => {
                  controller.enqueue(new TextEncoder().encode('{"suggestions":[]}'));
                  controller.close();
                }, 100);
              },
            }),
            { headers: { 'content-type': 'application/json' } },
          )
        : undefined,
    );
    const box = shell();
    type(box, 'zzzz');
    await screen.findByText('Keine Treffer', { selector: 'div:not([role=status])' });
    type(box, 'zzzzz');
    // Through the debounce, the request and the answer, the panel and the status never blank.
    for (let i = 0; i < 40; i++) {
      expect(
        screen.queryByText('Keine Treffer', { selector: 'div:not([role=status])' }),
      ).not.toBeNull();
      expect(screen.getByTestId('typeahead-status').textContent).toBe('Keine Treffer');
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(suggestCalls(calls)).toHaveLength(2);
  });

  it('stays closed when the request fails', async () => {
    const calls = answer({ error: { code: 'internal', message: 'x', requestId: 'r' } }, 500);
    const box = shell();
    type(box, 'lds3');
    await waitFor(() => expect(suggestCalls(calls)).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.queryByText('Keine Treffer')).toBeNull();
    expect(box.getAttribute('aria-expanded')).toBe('false');
  });
});
