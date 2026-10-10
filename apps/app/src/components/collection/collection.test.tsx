import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, renderHook, screen, waitFor, within } from '@testing-library/react';
import type {
  Binder,
  CollectionEntry,
  CollectionSummary,
  EntriesResponse,
} from '@voidbinder/shared/api';
import { useLocalSearchParams } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, json, renderApp, signedIn, type Call } from '../../../test/fake-api';
import { setFetch } from '../../../test/fetch';
import { useEntries, useOwned, useUpdateEntry } from '../../api/queries/collection';
import Collection from '../../app/(protected)/collection';
import CardPage from '../../app/cards/[id]';
import { useOwnedPrints } from '../catalog/seams';
import { moveId } from './Binders';
import { QuickAdd } from './CollectButtons';
import { parseCents } from './format';

const at = '2026-10-09T03:00:00.000Z';
const binder: Binder = {
  id: 'b0000000-0000-4000-8000-000000000001',
  name: 'Magic Foils',
  game: 'mtg',
  position: 0,
  colour: null,
  createdAt: at,
  updatedAt: at,
};
const emptyBinder: Binder = {
  ...binder,
  id: 'b0000000-0000-4000-8000-000000000002',
  name: 'Neue Mappe Oktober',
  game: null,
  position: 1,
};
const entry: CollectionEntry = {
  id: 'e0000000-0000-4000-8000-000000000001',
  printId: 'p0000000-0000-4000-8000-000000000001',
  binderId: binder.id,
  quantity: 2,
  language: 'de',
  condition: 'NM',
  finish: 'foil',
  purchasePriceCents: 250,
  purchaseCurrency: 'USD',
  note: null,
  createdAt: at,
  updatedAt: at,
  print: {
    id: 'p0000000-0000-4000-8000-000000000001',
    cardId: 'c0000000-0000-4000-8000-000000000001',
    game: 'mtg',
    setCode: 'mid',
    setName: 'Innistrad: Midnight Hunt',
    number: '1',
    displayNumber: '1',
    displayCode: 'MID 1',
    cardFormat: 'standard',
    name: 'Adeline, strahlende Katharerin',
    rarity: 'rare',
    finishes: ['normal', 'foil'],
    imageUrl: null,
  },
  price: {
    source: 'cardmarket',
    finish: 'foil',
    lang: 'de',
    currency: 'EUR',
    marketCents: 320,
    factor: 1,
    unitCents: 320,
    observedAt: at,
  },
};
const value = (cents: number) => ({
  cards: 2,
  entries: 1,
  unpriced: 0,
  totals: [{ source: 'cardmarket' as const, currency: 'EUR' as const, cents, observedAt: at }],
});
const summary: CollectionSummary = {
  collection: {
    ...value(640),
    estimate: false,
    games: [{ ...value(640), game: 'mtg' }],
    binders: [{ ...value(640), binderId: binder.id }],
  },
  wishlist: { cards: 0, entries: 0, unpriced: 0, totals: [], games: [], inBudget: 0 },
};
const page = (entries: CollectionEntry[]): EntriesResponse => ({
  entries,
  page: 1,
  pageSize: 50,
  total: entries.length,
});

/** The collection routes of the fake API; `patch` answers PATCH /collection/entries/:id. */
function collectionApi(
  patch: (call: Call) => Response = (c) => json({ ...entry, ...(c.body as object) }),
) {
  return fakeApi(signedIn, (c) => {
    if (c.path === '/collection/summary') return json(summary);
    if (c.path === '/collection/binders') return json({ binders: [binder, emptyBinder] });
    if (c.path.startsWith('/collection/entries?binder=b0000000-0000-4000-8000-000000000002'))
      return json(page([]));
    if (c.method === 'GET' && c.path.startsWith('/collection/entries')) return json(page([entry]));
    if (c.method === 'PATCH' && c.path === `/collection/entries/${entry.id}`) return patch(c);
    if (c.path.startsWith('/collection/wishlist'))
      return json({ entries: [], page: 1, pageSize: 50, total: 0 });
    return undefined;
  });
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('collection helpers', () => {
  it('parses typed prices as cents in German and English notation', () => {
    expect(parseCents('2,50 €')).toBe(250);
    expect(parseCents('1.234,5')).toBe(123450);
    expect(parseCents('1,234.50')).toBe(123450);
    expect(parseCents('3')).toBe(300);
    expect(parseCents('')).toBeNull();
    expect(parseCents('  ')).toBeNull();
    expect(parseCents('abc')).toBe('invalid');
    expect(parseCents('€')).toBe('invalid');
  });

  it('moves a binder id to a new place', () => {
    expect(moveId(['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b']);
    expect(moveId(['a', 'b', 'c'], 'a', 9)).toEqual(['b', 'c', 'a']);
  });
});

describe('collection hooks', () => {
  it('useEntries sends the filters as query params, leaving unset ones out', async () => {
    const calls = collectionApi();
    const { result } = renderHook(
      () => useEntries({ game: 'mtg', condition: undefined, q: 'adel', page: 2 }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls.find((c) => c.path.startsWith('/collection/entries'))).toMatchObject({
      method: 'GET',
      path: '/collection/entries?game=mtg&q=adel&page=2',
      credentials: 'include',
    });
  });

  it('useUpdateEntry shows a new quantity at once and rolls it back when the API refuses', async () => {
    let answer: (r: Response) => void = () => undefined;
    // The PATCH waits until the test answers it.
    setFetch(async (input, init) => {
      const req = new Request(input, init);
      if (req.method === 'PATCH') return new Promise<Response>((resolve) => (answer = resolve));
      return json(page([entry]));
    });
    const { result } = renderHook(() => ({ list: useEntries({}), update: useUpdateEntry() }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.list.data?.entries[0]?.quantity).toBe(2));
    result.current.update.mutate({ id: entry.id, quantity: 3 });
    await waitFor(() => expect(result.current.list.data?.entries[0]?.quantity).toBe(3));
    answer(json({ error: { code: 'internal', message: 'x', requestId: 'r' } }, 500));
    await waitFor(() => expect(result.current.update.isError).toBe(true));
    expect(result.current.list.data?.entries[0]?.quantity).toBe(2);
  });

  it('useOwned asks for the print ids once signed in, and not at all signed out', async () => {
    const calls = fakeApi((c) =>
      c.path.startsWith('/collection/owned') ? json({ owned: { a: 2 }, wished: {} }) : undefined,
    );
    const { result } = renderHook(() => useOwned(['b', 'a']), { wrapper });
    await waitFor(() => expect(result.current.data?.owned).toEqual({ a: 2 }));
    expect(calls[0]?.path).toBe('/collection/owned?printIds=a%2Cb');
    renderHook(() => useOwned(['c'], false), { wrapper });
    expect(calls).toHaveLength(1);
  });
});

describe('set page seam', () => {
  it('useOwnedPrints reads a whole set once signed in, with copies per finish', async () => {
    const calls = fakeApi(signedIn, (c) =>
      c.path.startsWith('/collection/owned')
        ? json({ owned: { p1: 3 }, byFinish: { p1: { normal: 2, foil: 1 } }, wished: {} })
        : undefined,
    );
    const { result } = renderHook(() => useOwnedPrints('mtg', 'mid'), { wrapper });
    await waitFor(() =>
      expect(result.current?.get('p1')).toEqual({ count: 3, byFinish: { normal: 2, foil: 1 } }),
    );
    expect(calls.find((c) => c.path.startsWith('/collection/owned'))?.path).toBe(
      '/collection/owned?game=mtg&set=mid',
    );
  });

  it('useOwnedPrints is undefined and asks nothing while signed out', async () => {
    const calls = fakeApi();
    const { result } = renderHook(() => useOwnedPrints('mtg', 'mid'), { wrapper });
    await waitFor(() => expect(calls.some((c) => c.path === '/me')).toBe(true));
    expect(result.current).toBeUndefined();
    expect(calls.some((c) => c.path.startsWith('/collection'))).toBe(false);
  });
});

// jsdom has no width, so the screen renders its phone layout.
describe('collection screen', () => {
  it('shows the value with source and date, the binders and the entries', async () => {
    collectionApi();
    renderApp(<Collection />);
    const panel = await screen.findByRole('region', { name: 'Sammlungswert' });
    expect(within(panel).getAllByText('6,40 €').length).toBeGreaterThan(0);
    expect(screen.getByText(/Nach Cardmarket, Stand 09\.10\.2026\./)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Habe/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: /Magic Foils/ })).toBeTruthy();
    expect(await screen.findByText('Adeline, strahlende Katharerin')).toBeTruthy();
    expect(screen.getByText('1 · DE · NM · Foil')).toBeTruthy();
  });

  it('says there are no prices yet instead of a number', async () => {
    fakeApi(signedIn, (c) => {
      if (c.path === '/collection/summary')
        return json({
          ...summary,
          collection: { ...summary.collection, totals: [], unpriced: 2, games: [], binders: [] },
        });
      if (c.path === '/collection/binders') return json({ binders: [] });
      if (c.path.startsWith('/collection/entries')) return json(page([{ ...entry, price: null }]));
      return undefined;
    });
    renderApp(<Collection />);
    expect(await screen.findByText(/Noch keine Preise/)).toBeTruthy();
    expect(screen.queryByText(/€/)).toBeNull();
  });

  it('shows a copy’s number in its language, the picture in its card format (VB-97)', async () => {
    const ygo: CollectionEntry = {
      ...entry,
      finish: 'normal',
      print: {
        ...entry.print,
        game: 'yugioh',
        setCode: 'blgg',
        number: 'EN024',
        displayNumber: 'DE024',
        displayCode: 'BLGG-DE024',
        cardFormat: 'japanese',
        imageUrl: 'https://img.voidbinder.de/images/yugioh/34950192/en/sm.webp',
      },
    };
    fakeApi(signedIn, (c) => {
      if (c.path === '/collection/summary') return json(summary);
      if (c.path === '/collection/binders') return json({ binders: [] });
      if (c.path.startsWith('/collection/entries')) return json(page([ygo]));
      return undefined;
    });
    const { container } = renderApp(<Collection />);
    expect(await screen.findByText('DE024 · DE · NM · Normal')).toBeTruthy();
    const thumb = container.querySelector('[style*="aspect-ratio"]') as HTMLElement;
    expect(thumb.style.aspectRatio).toBe(`${59 / 86} / 1`);
    const picture = thumb.querySelector('[style*="background-image"]') as HTMLElement;
    expect(getComputedStyle(picture).backgroundSize).toBe('contain');
  });

  it('saves the edit form with every field', async () => {
    const calls = collectionApi();
    renderApp(<Collection />);
    fireEvent.click(await screen.findByRole('button', { name: /Adeline.*bearbeiten/ }));
    const form = await screen.findByRole('form');
    fireEvent.click(within(form).getByRole('button', { name: 'Anzahl: eins mehr' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({
        quantity: 3,
        language: 'de',
        finish: 'foil',
        condition: 'NM',
        binderId: binder.id,
        purchasePriceCents: 250,
        // The stored currency stays, though the entry is valued in EUR.
        purchaseCurrency: 'USD',
      }),
    );
  });

  it('blocks saving a purchase price without a digit and says why', async () => {
    const calls = collectionApi();
    renderApp(<Collection />);
    fireEvent.click(await screen.findByRole('button', { name: /Adeline.*bearbeiten/ }));
    const form = await screen.findByRole('form');
    fireEvent.change(within(form).getByLabelText('Kaufpreis je Karte'), {
      target: { value: 'abc' },
    });
    expect(await within(form).findByText(/Gib einen Betrag/)).toBeTruthy();
    fireEvent.click(within(form).getByRole('button', { name: 'Speichern' }));
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
    fireEvent.change(within(form).getByLabelText('Kaufpreis je Karte'), {
      target: { value: '' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({
        purchasePriceCents: null,
        purchaseCurrency: null,
      }),
    );
  });

  it('rolls an edit back when the API refuses it', async () => {
    collectionApi(() => json({ error: { code: 'internal', message: 'x', requestId: 'r' } }, 500));
    renderApp(<Collection />);
    fireEvent.click(await screen.findByRole('button', { name: /Adeline.*bearbeiten/ }));
    const form = await screen.findByRole('form');
    fireEvent.click(within(form).getByRole('button', { name: 'Anzahl: eins mehr' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Speichern' }));
    expect(await screen.findByText(/Die alten Werte sind wiederhergestellt/)).toBeTruthy();
    expect(screen.getByText('2×')).toBeTruthy();
    expect(screen.queryByText('3×')).toBeNull();
  });

  it('shows the pocket page for an empty binder', async () => {
    collectionApi();
    renderApp(<Collection />);
    fireEvent.click(await screen.findByRole('button', { name: /Neue Mappe Oktober/ }));
    expect(await screen.findByText('„Neue Mappe Oktober“ ist noch leer')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Aus Sammlung verschieben' })).toBeTruthy();
  });

  it('switches to the wish list tab', async () => {
    collectionApi();
    renderApp(<Collection />);
    fireEvent.click(await screen.findByRole('button', { name: /Will/ }));
    expect(await screen.findByText(/Deine Wunschliste ist leer/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Will/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: /Habe/ }).getAttribute('aria-pressed')).toBe('false');
  });
});

describe('wide layout', () => {
  beforeEach(() => {
    Object.defineProperty(document.documentElement, 'clientWidth', {
      value: 1200,
      configurable: true,
    });
    Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true });
    window.dispatchEvent(new Event('resize'));
  });
  afterEach(() => {
    Reflect.deleteProperty(document.documentElement, 'clientWidth');
    Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
    window.dispatchEvent(new Event('resize'));
  });

  it('replaces a row’s stepper with the plain number while its form is open', async () => {
    collectionApi();
    renderApp(<Collection />);
    expect(await screen.findAllByRole('button', { name: /Adeline.*eins mehr/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /Adeline.*bearbeiten/ }));
    await screen.findByRole('form');
    expect(screen.queryAllByRole('button', { name: /Adeline.*eins mehr/ })).toHaveLength(0);
    // The form's own stepper is the only one left.
    expect(screen.getAllByRole('button', { name: 'Anzahl: eins mehr' })).toHaveLength(1);
  });
});

describe('card page collection buttons', () => {
  const CARD = 'c0000000-0000-4000-8000-000000000001';
  const PRINT = entry.printId;
  beforeEach(() => vi.mocked(useLocalSearchParams).mockReturnValue({ id: CARD }));
  const card = {
    card: {
      id: CARD,
      game: 'mtg',
      name: 'Adeline, Resplendent Cathar',
      typeLine: 'Legendary Creature',
      text: null,
      attributes: {},
      legalities: {},
    },
    prints: [
      {
        id: PRINT,
        cardId: CARD,
        set: { game: 'mtg', code: 'mid', name: 'Innistrad: Midnight Hunt' },
        number: '1',
        displayNumber: '1',
        displayCode: 'MID 1',
        cardFormat: 'standard',
        variant: '',
        rarity: 'rare',
        finishes: ['normal', 'foil'],
        artist: null,
        releasedOn: null,
        imageUrl: null,
        externalIds: {},
        localizations: [
          { lang: 'de', name: 'Adeline, strahlende Katharerin', text: null, imageUrl: null },
        ],
      },
    ],
    copyright: '©Wizards of the Coast LLC',
  };

  it('adds the print in the user’s language and shows how many copies there are', async () => {
    let copies = 1;
    const calls = fakeApi(signedIn, (c) => {
      if (c.path.startsWith(`/catalog/cards/${CARD}`)) return json(card);
      if (c.path.startsWith('/collection/owned'))
        return json({ owned: { [PRINT]: copies }, wished: {} });
      if (c.method === 'POST' && c.path === '/collection/entries') {
        copies += 1;
        return json({ entries: [entry] }, 201);
      }
      return undefined;
    });
    renderApp(<CardPage />);
    expect(await screen.findByText('Du hast 1× in deiner Sammlung')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '+ In Sammlung' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Hinzufügen' }));
    expect(await screen.findByText('Du hast 2× in deiner Sammlung')).toBeTruthy();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual([
      expect.objectContaining({ printId: PRINT, finish: 'normal', language: 'de' }),
    ]);
  });
});

describe('adding from the search', () => {
  const CARD = entry.print.cardId;
  const PRINT = entry.printId;
  const cardWith = (langs: string[]) => ({
    card: {
      id: CARD,
      game: 'mtg',
      name: 'Adeline',
      typeLine: '',
      text: null,
      attributes: {},
      legalities: {},
    },
    prints: [
      {
        id: PRINT,
        cardId: CARD,
        set: { game: 'mtg', code: 'mid', name: 'Innistrad: Midnight Hunt' },
        number: '1',
        displayNumber: '1',
        displayCode: 'MID 1',
        cardFormat: 'standard',
        variant: '',
        rarity: 'rare',
        finishes: ['normal'],
        artist: null,
        releasedOn: null,
        imageUrl: null,
        externalIds: {},
        localizations: langs.map((lang) => ({ lang, name: 'Adeline', text: null, imageUrl: null })),
      },
    ],
    copyright: '',
  });

  it.each([
    [['en', 'de'], 'de'],
    [['en'], 'en'],
  ])(
    'QuickAdd uses the user’s language only when the print has it (%j → %s)',
    async (langs, language) => {
      const calls = fakeApi(signedIn, (c) => {
        if (c.path.startsWith(`/catalog/cards/${CARD}`)) return json(cardWith(langs));
        if (c.method === 'POST' && c.path === '/collection/entries')
          return json({ entries: [] }, 201);
        return undefined;
      });
      renderApp(<QuickAdd printId={PRINT} cardId={CARD} name="Adeline" finish="normal" />);
      fireEvent.click(await screen.findByRole('button', { name: /Adeline/ }));
      await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
      expect(calls.find((c) => c.method === 'POST')?.body).toEqual([
        expect.objectContaining({ printId: PRINT, language }),
      ]);
    },
  );

  it('a retried add sends the same client id; a new one after it went through', async () => {
    let fail = true;
    const calls = fakeApi(signedIn, (c) => {
      if (c.path.startsWith(`/catalog/cards/${CARD}`)) return json(cardWith(['en']));
      if (c.method === 'POST' && c.path === '/collection/entries') {
        if (!fail) return json({ entries: [] }, 201);
        fail = false;
        return json({ error: { code: 'internal', message: 'x', requestId: 'r' } }, 500);
      }
      return undefined;
    });
    renderApp(<QuickAdd printId={PRINT} cardId={CARD} name="Adeline" finish="normal" />);
    const press = async (n: number) => {
      fireEvent.click(await screen.findByRole('button', { name: /Adeline/ }));
      await waitFor(() => expect(calls.filter((c) => c.method === 'POST')).toHaveLength(n));
      await waitFor(() =>
        expect(screen.getByRole('button').getAttribute('aria-busy')).toBe('false'),
      );
    };
    await press(1);
    await press(2);
    await press(3);
    const ids = calls
      .filter((c) => c.method === 'POST')
      .map((c) => (c.body as { id: string }[])[0]?.id);
    expect(ids[0]).toBeTruthy();
    expect(ids[1]).toBe(ids[0]);
    expect(ids[2]).not.toBe(ids[0]);
  });

  it('starts a fresh client id when the print changes after a failed add', async () => {
    const calls = fakeApi(signedIn, (c) => {
      if (c.path.startsWith(`/catalog/cards/${CARD}`)) return json(cardWith(['en']));
      if (c.method === 'POST' && c.path === '/collection/entries')
        return json({ error: { code: 'internal', message: 'x', requestId: 'r' } }, 500);
      return undefined;
    });
    // The same QuickAdd instance switches to another print, as the card page does on pick.
    function Switcher() {
      const [printId, setPrintId] = useState(PRINT);
      return (
        <>
          <QuickAdd printId={printId} cardId={CARD} name="Adeline" finish="normal" />
          <button type="button" onClick={() => setPrintId(`${PRINT.slice(0, -1)}9`)}>
            switch
          </button>
        </>
      );
    }
    renderApp(<Switcher />);
    const press = async (n: number) => {
      fireEvent.click(await screen.findByRole('button', { name: /Adeline/ }));
      await waitFor(() => expect(calls.filter((c) => c.method === 'POST')).toHaveLength(n));
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /Adeline/ }).getAttribute('aria-busy')).toBe(
          'false',
        ),
      );
    };
    await press(1);
    fireEvent.click(screen.getByRole('button', { name: 'switch' }));
    await press(2);
    const ids = calls
      .filter((c) => c.method === 'POST')
      .map((c) => (c.body as { id: string }[])[0]?.id);
    expect(ids[1]).not.toBe(ids[0]);
  });
});
