import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, renderHook, screen, waitFor, within } from '@testing-library/react';
import type { DeckDetail, DeckEntry, DeckEntryInput, DecksResponse } from '@voidbinder/shared/api';
import { router, useLocalSearchParams } from 'expo-router';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fakeApi, json, renderApp, signedIn, type Call } from '../../../test/fake-api';
import { setFetch } from '../../../test/fetch';
import { useDeck, useDeckEntries, usePutEntries, useWishMissing } from '../../api/queries/decks';
import DeckPage from '../../app/(protected)/decks/[id]';
import Decks from '../../app/(protected)/decks/index';
import { de } from '../../i18n/de';
import { en } from '../../i18n/en';
import { deckText, problemText } from './format';

const at = '2026-10-09T03:00:00.000Z';
const DECK = 'd0000000-0000-4000-8000-000000000001';
const id = (n: number) => `c0000000-0000-4000-8000-00000000000${n}`;
const pid = (n: number) => `p0000000-0000-4000-8000-00000000000${n}`;
const eur = (cents: number) => ({
  source: 'cardmarket' as const,
  finish: 'normal',
  currency: 'EUR' as const,
  marketCents: cents,
  factor: 1,
  unitCents: cents,
  observedAt: at,
});
const line = (n: number, extra: Partial<DeckEntry>): DeckEntry => ({
  cardId: id(n),
  printId: null,
  zone: 'main',
  quantity: 3,
  name: `Karte ${n}`,
  typeLine: 'Effect Monster',
  group: 'monster',
  stat: { kind: 'level', value: 4 },
  print: { id: pid(n), setCode: 'lob', number: `EN00${n}`, imageUrl: null },
  owned: 3,
  limit: 3,
  price: eur(100),
  ...extra,
});

const deck: DeckDetail = {
  id: DECK,
  game: 'yugioh',
  name: 'Nebelwacht',
  format: 'advanced',
  description: null,
  createdAt: at,
  updatedAt: at,
  entries: [
    line(1, { name: 'Nebelwächter', owned: 3 }),
    line(2, { name: 'Schleierorakel', owned: 2, price: eur(890) }),
    line(3, { name: 'Ruf der Leere', typeLine: 'Spell Card', group: 'spell', stat: null }),
    line(4, {
      name: 'Glasflügel-Drache',
      zone: 'extra',
      quantity: 1,
      owned: 0,
      typeLine: 'Synchro Monster',
      stat: { kind: 'level', value: 7 },
      price: eur(980),
    }),
  ],
  analysis: {
    valid: false,
    problems: [{ code: 'too_few', params: { zone: 'main', count: 9, min: 40 } }],
    rules: {
      zones: { main: { min: 40, max: 60 }, extra: { max: 15 }, side: { max: 15 } },
      copies: 3,
    },
    counts: { main: 9, extra: 1 },
    curve: {
      kind: 'level',
      buckets: ['1', '2', '3', '4', '5', '6', '7', '8+'].map((label) => ({
        label,
        count: label === '4' ? 6 : 0,
      })),
    },
    missing: [
      {
        cardId: id(2),
        name: 'Schleierorakel',
        englishName: 'Veil Oracle',
        printId: pid(2),
        setCode: 'lob',
        number: 'EN002',
        needed: 3,
        owned: 2,
        unitPriceCents: 890,
        currency: 'EUR',
        source: 'cardmarket',
        observedAt: at,
      },
      {
        cardId: id(4),
        name: 'Glasflügel-Drache',
        englishName: 'Glass Wing Dragon',
        printId: pid(4),
        setCode: 'lob',
        number: 'EN004',
        needed: 1,
        owned: 0,
        unitPriceCents: 980,
        currency: 'EUR',
        source: 'cardmarket',
        observedAt: at,
      },
    ],
    missingValue: {
      cards: 2,
      entries: 2,
      unpriced: 0,
      totals: [{ source: 'cardmarket', currency: 'EUR', cents: 1870, observedAt: at }],
    },
    value: {
      cards: 10,
      entries: 4,
      unpriced: 0,
      totals: [{ source: 'cardmarket', currency: 'EUR', cents: 4950, observedAt: at }],
    },
    collectionCards: 612,
  },
};

const search = {
  prints: [
    {
      id: pid(5),
      cardId: id(5),
      number: 'EN005',
      variant: '',
      name: 'Nebelschwinge',
      rarity: 'Common',
      finishes: ['normal'],
      imageUrl: null,
      marketPrice: { source: 'tcgplayer', finish: 'normal', currency: 'USD', cents: 40 },
      game: 'yugioh',
      setCode: 'lob',
      setName: 'Legend of Blue Eyes',
    },
    {
      id: pid(1),
      cardId: id(1),
      number: 'EN001',
      variant: '',
      name: 'Nebelwächter',
      rarity: 'Common',
      finishes: ['normal'],
      imageUrl: null,
      marketPrice: null,
      game: 'yugioh',
      setCode: 'lob',
      setName: 'Legend of Blue Eyes',
    },
    {
      id: pid(6),
      cardId: id(6),
      number: 'EN006',
      variant: '',
      name: 'Nebeldrache',
      rarity: 'Ultra Rare',
      finishes: ['normal'],
      imageUrl: null,
      marketPrice: null,
      typeLine: 'Synchro Effect Monster',
      game: 'yugioh',
      setCode: 'lob',
      setName: 'Legend of Blue Eyes',
    },
  ],
  page: 1,
  pageSize: 30,
  total: 3,
};

/** A PUT's answer: the deck with the lines it was sent (known ones as they were, new ones plain). */
const echo = (c: Call) =>
  json({
    ...deck,
    entries: (c.body as { entries: DeckEntryInput[] }).entries.map((e) => {
      const known = deck.entries.find((d) => d.cardId === e.cardId && d.zone === e.zone);
      return known
        ? { ...known, quantity: e.quantity }
        : line(9, {
            cardId: e.cardId,
            printId: e.printId ?? null,
            zone: e.zone,
            quantity: e.quantity,
          });
    }),
  });

/** The deck routes of the fake API; PUT answers the deck with the entries it was sent. */
function deckApi(put: (call: Call) => Response = echo) {
  return fakeApi(signedIn, (c) => {
    if (c.method === 'GET' && c.path.startsWith(`/decks/${DECK}`)) return json(deck);
    if (c.method === 'PUT' && c.path === `/decks/${DECK}/entries`) return put(c);
    if (c.path.startsWith('/catalog/search')) return json(search);
    if (c.method === 'POST' && c.path === '/collection/wishlist') return json({ entries: [] }, 201);
    return undefined;
  });
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const putBody = (calls: Call[]) =>
  (calls.findLast((c) => c.method === 'PUT')?.body as { entries: unknown[] } | undefined)?.entries;

describe('deck helpers', () => {
  it('words problems in the user’s language, zones included', () => {
    const p = deck.analysis.problems[0];
    if (!p) throw new Error('no problem');
    expect(problemText(de, p)).toBe('Hauptdeck: 9 Karten, mindestens 40 nötig.');
    expect(problemText(en, p)).toBe('Main deck: 9 cards, at least 40 needed.');
    expect(problemText(de, { code: 'banned', params: { name: 'Pot of Greed' } })).toBe(
      'Pot of Greed ist in diesem Format verboten.',
    );
    // Yu-Gi-Oh!'s limits come from the TCG list and say so (VB-81).
    const many = {
      code: 'too_many_copies',
      params: { name: 'Raigeki', count: 3, limit: 1 },
    } as const;
    expect(problemText(de, many, 'yugioh')).toBe('Raigeki: 3 Exemplare, max. 1 laut TCG-Liste.');
    expect(problemText(en, { code: 'banned', params: { name: 'Pot of Greed' } }, 'yugioh')).toBe(
      'Pot of Greed is forbidden by the TCG list (max. 0).',
    );
  });

  it('writes a list as "n Name" lines', () => {
    expect(
      deckText([
        { quantity: 2, name: 'A' },
        { quantity: 1, name: 'B' },
      ]),
    ).toBe('2 A\n1 B');
  });
});

describe('deck hooks', () => {
  it('usePutEntries shows a change at once and drops it when the API refuses', async () => {
    let answer: (r: Response) => void = () => undefined;
    setFetch(async (input, init) => {
      const req = new Request(input, init);
      if (req.method === 'PUT') return new Promise<Response>((resolve) => (answer = resolve));
      return json(deck);
    });
    const { result } = renderHook(
      () => {
        const query = useDeck(DECK);
        return {
          entries: useDeckEntries(DECK, query.data?.entries ?? []),
          put: usePutEntries(DECK),
        };
      },
      { wrapper },
    );
    await waitFor(() => expect(result.current.entries[0]?.quantity).toBe(3));
    result.current.put.mutate((list) =>
      list.flatMap((e) =>
        e.cardId === id(1) ? [{ ...e, quantity: 1 }] : e.cardId === id(3) ? [e] : [],
      ),
    );
    await waitFor(() => expect(result.current.entries[0]?.quantity).toBe(1));
    // Lines left out disappear at once.
    expect(result.current.entries.map((e) => e.cardId)).toEqual([id(1), id(3)]);
    answer(json({ error: { code: 'internal', message: 'x', requestId: 'r' } }, 500));
    await waitFor(() => expect(result.current.put.isError).toBe(true));
    expect(result.current.entries).toHaveLength(4);
  });

  it('useWishMissing adds one wish per missing card and takes "already wished" as done', async () => {
    const calls = fakeApi((c) =>
      c.method === 'POST' && c.path === '/collection/wishlist'
        ? (c.body as { printId: string }).printId === pid(2)
          ? json({ error: { code: 'conflict', message: 'x', requestId: 'r' } }, 409)
          : json({ entries: [] }, 201)
        : undefined,
    );
    const { result } = renderHook(() => useWishMissing(), { wrapper });
    result.current.mutate(deck.analysis.missing);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.body)).toEqual([
      { id: expect.any(String), printId: pid(2), quantity: 1 },
      { id: expect.any(String), printId: pid(4), quantity: 1 },
    ]);
  });
});

// jsdom has no width: the phone layout, one column.
describe('deck screen', () => {
  vi.mocked(useLocalSearchParams).mockReturnValue({ id: DECK });

  it('shows the header, the rules, the problems, the list and what is missing', async () => {
    deckApi();
    renderApp(<DeckPage />);
    expect(await screen.findByText('Hauptdeck: 9 Karten, mindestens 40 nötig.')).toBeTruthy();
    expect(screen.getByText('Advanced')).toBeTruthy();
    expect(screen.getByText('nicht legal: 1')).toBeTruthy();
    expect(screen.getByText(/Deckwert 49,50\s€ nach Cardmarket/)).toBeTruthy();
    const rules = screen.getByRole('list', { name: 'Deckregeln' });
    expect(within(rules).getByText(/von 40 bis 60/)).toBeTruthy();
    expect(within(rules).getByText('Limit-Liste erfüllt')).toBeTruthy();

    // Grouped by type, "habe" and "fehlt" per row.
    expect(screen.getByRole('group', { name: 'Monster' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Zauber' })).toBeTruthy();
    expect(screen.getAllByText('habe 3').length).toBe(2);
    expect(screen.getByText('fehlt 1')).toBeTruthy();
    expect(screen.getByText(/Stufe 4 · Effect Monster · LOB-EN001/)).toBeTruthy();

    const need = screen.getByRole('region', { name: 'Was fehlt mir' });
    expect(within(need).getByText('2 Karten')).toBeTruthy();
    expect(within(need).getByText(/Abgeglichen mit allen 612 Karten/)).toBeTruthy();
    expect(within(need).getByText(/LOB-EN002 · je 8,90\s€/)).toBeTruthy();
    expect(within(need).getByText(/nach Cardmarket, Stand 09\.10\.2026/)).toBeTruthy();
    expect(within(need).getByText(/18,70\s€/)).toBeTruthy();
    expect(screen.getByRole('img', { name: /4: 6/ })).toBeTruthy();
  });

  it('switches zones and steps quantities, removing a line at zero', async () => {
    const calls = deckApi();
    renderApp(<DeckPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Extra/ }));
    expect(screen.queryByRole('button', { name: 'Nebelwächter: eins weniger' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Glasflügel-Drache: eins weniger' }));
    await waitFor(() => expect(putBody(calls)).toHaveLength(3));
    expect(putBody(calls)).not.toContainEqual(expect.objectContaining({ cardId: id(4) }));

    fireEvent.click(screen.getByRole('button', { name: /Haupt/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Schleierorakel: eins weniger' }));
    await waitFor(() =>
      expect(putBody(calls)).toContainEqual({
        cardId: id(2),
        printId: null,
        zone: 'main',
        quantity: 2,
      }),
    );
    // Three copies is the limit in Yu-Gi-Oh!: + is off for a card that has them.
    expect(
      screen.getByRole('button', { name: 'Nebelwächter: eins mehr' }).getAttribute('aria-disabled'),
    ).toBe('true');
  });

  it('adds a search hit to the open zone with the hit as preferred print', async () => {
    const calls = deckApi();
    renderApp(<DeckPage />);
    fireEvent.change(await screen.findByLabelText('Karte suchen'), {
      target: { value: 'nebel' },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Nebelschwinge hinzufügen' }));
    await waitFor(() =>
      expect(putBody(calls)).toContainEqual({
        cardId: id(5),
        printId: pid(5),
        zone: 'main',
        quantity: 1,
      }),
    );
    expect(calls.find((c) => c.path.startsWith('/catalog/search'))?.path).toContain('game=yugioh');
    // A card with three copies in the deck cannot be added again.
    expect(
      screen
        .getByRole('button', { name: /^Nebelwächter hinzufügen/ })
        .getAttribute('aria-disabled'),
    ).toBe('true');
  });

  it('lands two quick adds, and an Extra Deck monster in the extra deck', async () => {
    const calls = deckApi();
    renderApp(<DeckPage />);
    fireEvent.change(await screen.findByLabelText('Karte suchen'), {
      target: { value: 'nebel' },
    });
    const addHit = await screen.findByRole('button', { name: 'Nebelschwinge hinzufügen' });
    fireEvent.click(addHit);
    fireEvent.click(addHit);
    fireEvent.click(screen.getByRole('button', { name: 'Nebeldrache hinzufügen' }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(3));
    const last = putBody(calls);
    expect(last).toContainEqual({ cardId: id(5), printId: pid(5), zone: 'main', quantity: 2 });
    expect(last).toContainEqual({ cardId: id(6), printId: pid(6), zone: 'extra', quantity: 1 });
    expect(last).toHaveLength(6);
  });

  it('stops the + at the ban list limit of a card', async () => {
    const limited = {
      ...deck,
      entries: [
        line(1, { name: 'Limitiert', quantity: 1, limit: 1 }),
        line(2, { name: 'Frei', quantity: 1 }),
      ],
    };
    fakeApi(signedIn, (c) => (c.path.startsWith(`/decks/${DECK}`) ? json(limited) : undefined));
    renderApp(<DeckPage />);
    const more = await screen.findByRole('button', { name: 'Limitiert: eins mehr' });
    expect(more.getAttribute('aria-disabled')).toBe('true');
    expect(
      screen.getByRole('button', { name: 'Frei: eins mehr' }).getAttribute('aria-disabled'),
    ).not.toBe('true');
  });

  it('copies the missing cards with their English names', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    deckApi();
    renderApp(<DeckPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Als Text kopieren' }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('1 Veil Oracle\n1 Glass Wing Dragon'),
    );
  });

  it('puts the missing cards on the wish list', async () => {
    const calls = deckApi();
    renderApp(<DeckPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Fehlende auf Wunschliste' }));
    expect(await screen.findByRole('button', { name: /Auf der Wunschliste/ })).toBeTruthy();
    expect(calls.filter((c) => c.path === '/collection/wishlist')).toHaveLength(2);
  });
});

describe('decks screen', () => {
  const list: DecksResponse = {
    decks: [
      {
        ...deck,
        valid: false,
        problems: 1,
        cards: 9,
        missing: 2,
        value: deck.analysis.value,
      },
    ],
  };

  it('lists decks with format, legality, value and missing copies', async () => {
    fakeApi(signedIn, (c) => (c.path === '/decks' ? json(list) : undefined));
    renderApp(<Decks />);
    expect(await screen.findByText('Nebelwacht')).toBeTruthy();
    expect(screen.getByText('49,50 €')).toBeTruthy();
    expect(screen.getByText('fehlen 2')).toBeTruthy();
    expect(screen.getByText('nicht legal: 1')).toBeTruthy();
  });

  it('creates a deck with game, format and name and opens it', async () => {
    const calls = fakeApi(signedIn, (c) => {
      if (c.method === 'GET' && c.path === '/decks') return json({ decks: [] });
      if (c.method === 'POST' && c.path === '/decks')
        return json({ ...deck, ...(c.body as object) }, 201);
      return undefined;
    });
    renderApp(<Decks />);
    expect(await screen.findByText(/Noch keine Decks/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Deck anlegen' }));
    expect(await screen.findByText('Gib dem Deck einen Namen.')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Magic' }));
    fireEvent.change(screen.getByLabelText('Name des Decks'), { target: { value: 'Weiß' } });
    fireEvent.click(screen.getByRole('button', { name: 'Deck anlegen' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
        id: expect.any(String),
        game: 'mtg',
        format: 'standard',
        name: 'Weiß',
      }),
    );
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith(
        `/decks/${(calls.find((c) => c.method === 'POST')?.body as { id: string }).id}`,
      ),
    );
  });
});
