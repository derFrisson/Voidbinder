import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useLocalSearchParams } from 'expo-router';
import { describe, expect, it, vi } from 'vitest';
import { fakeApi, json, renderApp } from '../test/fake-api';
import GameSets from './app/[game]/index';
import SetRoute from './app/[game]/sets/[code]';
import Home from './app/index';
import { CardCollection } from './components/catalog/Cards';
import { CardImage } from './components/catalog/CardImage';
import { SetHeader, ValueStrip } from './components/catalog/SetHeader';
import { SetList } from './components/catalog/SetList';
import { SetPage } from './components/catalog/SetPage';
import type { Owned, SetFilters } from './components/catalog/model';
import { PageScroll } from './components/Shell';
import { recordRecent } from './storage/recent';

const print = (n: number, extra: object = {}) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  cardId: `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  number: String(n),
  variant: '',
  name: `Card ${n}`,
  rarity: n % 2 ? 'rare' : 'common',
  finishes: ['normal', 'foil'],
  imageUrl: n === 1 ? 'https://img.voidbinder.de/images/mtg/1/en/sm.webp' : null,
  ...extra,
});

const setPage = (over: object = {}) => ({
  set: {
    code: 'mid',
    name: 'Innistrad: Midnight Hunt',
    localizedName: null,
    releasedOn: '2021-09-24',
    cardCount: 392,
    kind: 'expansion',
    game: 'mtg',
  },
  prints: [print(1), print(2), print(3)],
  page: 1,
  pageSize: 60,
  total: 391,
  facets: {
    rarities: [
      { rarity: 'common', count: 123 },
      { rarity: 'rare', count: 130 },
      { rarity: 'Ultra Rare', count: 3 },
    ],
    finishes: [
      { finish: 'normal', count: 391 },
      { finish: 'foil', count: 300 },
    ],
    languages: ['de', 'en'],
  },
  ...over,
});

const sets = {
  game: 'mtg',
  sets: [
    {
      code: 'mid',
      name: 'Innistrad: Midnight Hunt',
      localizedName: 'Innistrad: Mitternachtsjagd',
      releasedOn: '2021-09-24',
      cardCount: 392,
      kind: null,
    },
    {
      code: 'vow',
      name: 'Crimson Vow',
      localizedName: null,
      releasedOn: '2021-11-19',
      cardCount: 1,
      kind: null,
    },
    {
      code: 'old',
      name: 'Old One',
      localizedName: null,
      releasedOn: null,
      cardCount: null,
      kind: null,
    },
  ],
};

const error = (status: number) =>
  json(
    { error: { code: status === 404 ? 'not_found' : 'internal', message: 'x', requestId: 'r' } },
    status,
  );

const filters: SetFilters = { lang: 'de', sort: 'number', page: 1, view: 'grid' };

describe('set page', () => {
  it('shows the header, the facet chips, the cards and the pagination from the API', async () => {
    const calls = fakeApi((c) =>
      c.path.startsWith('/catalog/sets/mtg/mid') ? json(setPage()) : undefined,
    );
    renderApp(
      <SetPage game="mtg" code="mid" gameName="Magic" filters={filters} onChange={() => {}} />,
    );
    expect(await screen.findByText('Innistrad: Midnight Hunt')).toBeTruthy();
    // Header: code, release date in the user's language, cards, languages.
    expect(screen.getByText('MID')).toBeTruthy();
    expect(screen.getByText('24.09.2021')).toBeTruthy();
    expect(screen.getByText('DE · EN')).toBeTruthy();
    // Chips: Magic's rarities translated, other games' strings as they are, with their counts.
    const chips = within(screen.getByRole('group', { name: 'Seltenheit' }));
    expect(chips.getByRole('button', { name: /Häufig/ })).toBeTruthy();
    expect(chips.getByRole('button', { name: /Selten/ })).toBeTruthy();
    expect(chips.getByRole('button', { name: /Ultra Rare/ })).toBeTruthy();
    expect(screen.getByText('391 Karten, Seite 1')).toBeTruthy();
    // Cards: a link to the card page, named name + set code + number.
    const link = screen.getByRole('link', { name: 'Card 2, MID 2' });
    expect(link.getAttribute('href')).toBe('/cards/10000000-0000-4000-8000-000000000002');
    expect(screen.getByRole('navigation', { name: 'Seitenwahl' })).toBeTruthy();
    // Signed out: no owned badge, no "fehlt", no value strip.
    expect(screen.queryByText('fehlt')).toBeNull();
    expect(calls.find((c) => c.path.startsWith('/catalog/sets/mtg/mid'))?.path).toBe(
      '/catalog/sets/mtg/mid?lang=de&sort=number&page=1',
    );
  });

  it('renders the picture lazily with its size and an alt text, a frame without one', async () => {
    fakeApi((c) => (c.path.startsWith('/catalog/sets/') ? json(setPage()) : undefined));
    const { container } = renderApp(
      <SetPage game="mtg" code="mid" gameName="Magic" filters={filters} onChange={() => {}} />,
    );
    await screen.findByText('Card 1');
    const imgs = container.querySelectorAll('img');
    expect(imgs).toHaveLength(1);
    expect(imgs[0]?.getAttribute('loading')).toBe('lazy');
    expect(imgs[0]?.getAttribute('width')).toBe('250');
    expect(imgs[0]?.getAttribute('height')).toBe('350');
    expect(imgs[0]?.getAttribute('alt')).toBe('Card 1, MID 1');
    // Card 2 has no picture: the frame shows its number.
    fireEvent.error(imgs[0] as HTMLImageElement);
    await waitFor(() => expect(container.querySelectorAll('img')).toHaveLength(0));
  });

  it('asks for the filters it is given and reports a change with the page back at 1', async () => {
    const calls = fakeApi((c) =>
      c.path.startsWith('/catalog/sets/') ? json(setPage()) : undefined,
    );
    const onChange = vi.fn();
    renderApp(
      <SetPage
        game="mtg"
        code="mid"
        gameName="Magic"
        filters={{ ...filters, rarity: 'rare', page: 2, lang: 'en' }}
        onChange={onChange}
      />,
    );
    await screen.findByText('Card 1');
    expect(calls.find((c) => c.path.startsWith('/catalog/sets/'))?.path).toBe(
      '/catalog/sets/mtg/mid?lang=en&sort=number&page=2&rarity=rare',
    );
    // The active chip toggles off; another filter resets the page.
    fireEvent.click(screen.getByRole('button', { name: /Selten/ }));
    expect(onChange).toHaveBeenLastCalledWith({
      lang: 'en',
      sort: 'number',
      page: 1,
      view: 'grid',
    });
    fireEvent.click(screen.getByRole('radio', { name: 'Name' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'name', page: 1 }));
    fireEvent.click(screen.getByRole('button', { name: 'Seite 3' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ page: 3, rarity: 'rare' }));
  });

  it('shows the empty state for a filter without cards', async () => {
    fakeApi((c) =>
      c.path.startsWith('/catalog/sets/') ? json(setPage({ prints: [], total: 0 })) : undefined,
    );
    renderApp(
      <SetPage game="mtg" code="mid" gameName="Magic" filters={filters} onChange={() => {}} />,
    );
    expect(
      await screen.findByText('In diesem Set gibt es keine Karten mit diesen Filtern.'),
    ).toBeTruthy();
  });

  it('shows an error with retry for a failing API, and not found for an unknown set', async () => {
    let fail = true;
    fakeApi((c) =>
      c.path.startsWith('/catalog/sets/') ? (fail ? error(500) : json(setPage())) : undefined,
    );
    renderApp(
      <SetPage game="mtg" code="mid" gameName="Magic" filters={filters} onChange={() => {}} />,
    );
    await screen.findByRole('alert');
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(await screen.findByText('Card 1')).toBeTruthy();
  });

  it('says so for a set that does not exist', async () => {
    fakeApi((c) => (c.path.startsWith('/catalog/sets/') ? error(404) : undefined));
    renderApp(
      <SetPage game="mtg" code="zzz" gameName="Magic" filters={filters} onChange={() => {}} />,
    );
    expect(await screen.findByText('Das gibt es hier nicht.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('remembers the set as recently viewed', async () => {
    fakeApi((c) => (c.path.startsWith('/catalog/sets/') ? json(setPage()) : undefined));
    renderApp(
      <SetPage game="mtg" code="mid" gameName="Magic" filters={filters} onChange={() => {}} />,
    );
    await screen.findByText('Card 1');
    expect(JSON.parse(localStorage.getItem('voidbinder.recent') ?? '[]')).toEqual([
      { kind: 'set', game: 'mtg', code: 'mid', name: 'Innistrad: Midnight Hunt' },
    ]);
  });
});

describe('set page review fixes', () => {
  it('renders a response without facets', async () => {
    fakeApi((c) => {
      if (!c.path.startsWith('/catalog/sets/')) return undefined;
      const old: Partial<ReturnType<typeof setPage>> = setPage();
      delete old.facets;
      return json(old);
    });
    renderApp(
      <SetPage game="mtg" code="mid" gameName="Magic" filters={filters} onChange={() => {}} />,
    );
    expect(await screen.findByText('Card 1')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Seltenheit' })).toBeNull();
  });

  it('can always clear a filter from the URL, and says so in the empty state', async () => {
    fakeApi((c) =>
      c.path.startsWith('/catalog/sets/')
        ? json(
            setPage({
              prints: [],
              total: 0,
              facets: {
                rarities: [],
                finishes: [{ finish: 'normal', count: 391 }],
                languages: ['de'],
              },
            }),
          )
        : undefined,
    );
    const onChange = vi.fn();
    renderApp(
      <SetPage
        game="mtg"
        code="mid"
        gameName="Magic"
        filters={{ ...filters, rarity: 'mythic', finish: 'foil', page: 3 }}
        onChange={onChange}
      />,
    );
    await screen.findByText('In diesem Set gibt es keine Karten mit diesen Filtern.');
    // The finish control shows for the active finish although the set has one finish only.
    expect(screen.getByRole('radiogroup', { name: 'Ausführung' })).toBeTruthy();
    // The rarity the set does not have: a pressed chip with count 0, with a visible label.
    const chip = within(screen.getByRole('group', { name: 'Seltenheit' })).getByRole('button', {
      name: /Mythisch/,
    });
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    expect(chip.textContent).toContain('0');
    expect(screen.getAllByText('Seltenheit').length).toBeGreaterThan(1);
    fireEvent.click(screen.getByRole('button', { name: 'Filter zurücksetzen' }));
    expect(onChange).toHaveBeenLastCalledWith({
      lang: 'de',
      sort: 'number',
      page: 1,
      view: 'grid',
    });
  });

  it('shows only pictures from the image host, the frame for any other URL', async () => {
    fakeApi((c) =>
      c.path.startsWith('/catalog/sets/')
        ? json(
            setPage({
              prints: [
                print(1),
                print(2, { imageUrl: 'https://evil.example/x.webp' }),
                print(3, { imageUrl: 'http://img.voidbinder.de/x.webp' }),
                print(4, { imageUrl: 'not a url' }),
              ],
            }),
          )
        : undefined,
    );
    const { container } = renderApp(
      <SetPage game="mtg" code="mid" gameName="Magic" filters={filters} onChange={() => {}} />,
    );
    await screen.findByText('Card 4');
    const imgs = container.querySelectorAll('img');
    expect(imgs).toHaveLength(1);
    expect(imgs[0]?.getAttribute('src')).toBe('https://img.voidbinder.de/images/mtg/1/en/sm.webp');
  });
});

describe('second review round', () => {
  it('keeps sort and view out of the scrolling language row on phones', async () => {
    fakeApi((c) => (c.path.startsWith('/catalog/sets/') ? json(setPage()) : undefined));
    renderApp(
      <SetPage game="mtg" code="mid" gameName="Magic" filters={filters} onChange={() => {}} />,
    );
    await screen.findByText('Card 1');
    const row = (name: string) =>
      screen.getByRole('radiogroup', { name }).parentElement?.parentElement;
    expect(row('Sortierung')).toBe(row('Ansicht'));
    expect(row('Sprache')).toBe(row('Ausführung'));
    expect(row('Sprache')).not.toBe(row('Sortierung'));
  });

  it('scrolls the page back to the top when the page changes', async () => {
    fakeApi((c) => (c.path.startsWith('/catalog/sets/') ? json(setPage()) : undefined));
    const scrollTo = vi.fn();
    const onChange = vi.fn();
    renderApp(
      <PageScroll.Provider value={{ current: { scrollTo } as never }}>
        <SetPage game="mtg" code="mid" gameName="Magic" filters={filters} onChange={onChange} />
      </PageScroll.Provider>,
    );
    await screen.findByText('Card 1');
    expect(scrollTo).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Seite 3' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ page: 3 }));
    expect(scrollTo).toHaveBeenCalledWith({ y: 0 });
  });

  it('shows a new picture after a failed one when the uri changes', () => {
    const uri = (n: number) => `https://img.voidbinder.de/images/mtg/${n}/en/sm.webp`;
    const props = { alt: 'a', game: 'mtg' as const, number: '1' };
    const { container, rerender } = renderApp(<CardImage uri={uri(1)} {...props} />);
    fireEvent.error(container.querySelector('img') as HTMLImageElement);
    expect(container.querySelector('img')).toBeNull();
    rerender(<CardImage uri={uri(2)} {...props} />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe(uri(2));
  });

  it('labels the completion bar "Vollständigkeit" and has no owned-badge label', () => {
    const data = setPage() as never;
    const owned: Owned = new Map([[print(1).id, { count: 3, byFinish: { normal: 3 } }]]);
    const { rerender } = renderApp(<SetHeader data={data} gameName="Magic" owned={owned} />);
    expect(screen.getByRole('progressbar', { name: 'Vollständigkeit' })).toBeTruthy();
    rerender(
      <CardCollection
        prints={[print(1)]}
        view="grid"
        game="mtg"
        setCode="MID"
        owned={owned}
        prices={undefined}
      />,
    );
    expect(screen.getByText('3×').parentElement?.getAttribute('aria-label')).toBeNull();
  });
});

describe('set route', () => {
  it('turns the URL into filters and a bad game into not found', async () => {
    vi.mocked(useLocalSearchParams).mockReturnValue({ game: 'chess', code: 'mid' });
    const { unmount } = renderApp(<SetRoute />);
    expect((await screen.findAllByText('Das gibt es hier nicht.')).length).toBeGreaterThan(0);
    unmount();

    const calls = fakeApi((c) =>
      c.path.startsWith('/catalog/sets/') ? json(setPage()) : undefined,
    );
    vi.mocked(useLocalSearchParams).mockReturnValue({
      game: 'mtg',
      code: 'mid',
      rarity: 'rare',
      sort: 'bogus',
      page: '2',
    });
    renderApp(<SetRoute />);
    await screen.findByText('Card 1');
    expect(calls.find((c) => c.path.startsWith('/catalog/sets/'))?.path).toBe(
      '/catalog/sets/mtg/mid?lang=de&sort=number&page=2&rarity=rare',
    );
  });
});

describe('collection and prices', () => {
  const prints = [print(1), print(2)];
  const owned: Owned = new Map([
    [prints[0]?.id ?? '', { count: 2, byFinish: { normal: 1, foil: 1 } }],
  ]);

  it('marks owned copies with n× and missing cards with "fehlt"', () => {
    renderApp(
      <CardCollection
        prints={prints}
        view="grid"
        game="mtg"
        setCode="MID"
        owned={owned}
        prices={undefined}
      />,
    );
    expect(screen.getByText('2×')).toBeTruthy();
    expect(screen.getAllByText('fehlt')).toHaveLength(1);
  });

  it('shows the list with copies per finish', () => {
    renderApp(
      <CardCollection
        prints={prints}
        view="list"
        game="mtg"
        setCode="MID"
        owned={owned}
        prices={undefined}
      />,
    );
    expect(screen.getByText(/Normal 1× · Foil 1×/)).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('shows the price with source and date only when there is one', () => {
    const prices = new Map([
      [
        prints[0]?.id ?? '',
        { cents: 1234, currency: 'EUR' as const, source: 'Cardmarket', asOf: '2026-10-09' },
      ],
    ]);
    renderApp(
      <CardCollection
        prints={prints}
        view="grid"
        game="mtg"
        setCode="MID"
        owned={undefined}
        prices={prices}
      />,
    );
    expect(screen.getByText(/12,34/)).toBeTruthy();
    expect(screen.getByText('Cardmarket, Stand 09.10.2026')).toBeTruthy();
    expect(screen.queryByText('fehlt')).toBeNull();
  });

  it('hides the value strip without a collection or prices, shows it with both', () => {
    const prices = new Map([
      [
        prints[0]?.id ?? '',
        { cents: 500, currency: 'EUR' as const, source: 'Cardmarket', asOf: '2026-10-09' },
      ],
      [
        prints[1]?.id ?? '',
        { cents: 300, currency: 'EUR' as const, source: 'Cardmarket', asOf: '2026-10-09' },
      ],
    ]);
    const { container, rerender } = renderApp(<ValueStrip owned={undefined} prices={prices} />);
    expect(container.textContent).toBe('');
    rerender(<ValueStrip owned={owned} prices={undefined} />);
    expect(container.textContent).toBe('');
    rerender(<ValueStrip owned={owned} prices={prices} />);
    expect(screen.getByText('Deine 2 Karten')).toBeTruthy();
    expect(screen.getByText('Fehlende 1')).toBeTruthy();
  });
});

describe('game page', () => {
  it('lists the sets grouped by year with date and card count, then filters them', async () => {
    fakeApi((c) => (c.path === '/catalog/games/mtg/sets?lang=de' ? json(sets) : undefined));
    renderApp(<SetList game="mtg" />);
    expect(await screen.findByText('3 Sets')).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      '2021',
      'Ohne Datum',
    ]);
    // The localized name wins; date in the user's format, then the count ("1 Karte" in the singular; jsdom is phone-sized, so under the name).
    expect(screen.getByText('Innistrad: Mitternachtsjagd')).toBeTruthy();
    expect(screen.getByText(/^19\.11\.2021 · 1 Karte$/)).toBeTruthy();
    expect(screen.getByText(/^24\.09\.2021 · 392 Karten$/)).toBeTruthy();
    // The group of sets without a date is named "Ohne Datum", not left unnamed.
    expect(screen.getByRole('group', { name: 'Ohne Datum' })).toBeTruthy();
    expect(screen.getByRole('group', { name: '2021' })).toBeTruthy();
    const link = screen.getByText('Crimson Vow').closest('a');
    expect(link?.getAttribute('href')).toBe('/mtg/sets/vow');

    fireEvent.change(screen.getByLabelText('Sets filtern'), { target: { value: 'crimson' } });
    expect(screen.getByText('1 von 3 Sets')).toBeTruthy();
    expect(screen.queryByText('Old One')).toBeNull();
    fireEvent.change(screen.getByLabelText('Sets filtern'), { target: { value: 'zzz' } });
    expect(screen.getByText('Kein Set passt zu „zzz“.')).toBeTruthy();
  });

  it('names the flat list for the other sorts, and shows the game chip', async () => {
    vi.mocked(useLocalSearchParams).mockReturnValue({ game: 'mtg' });
    fakeApi((c) => (c.path.startsWith('/catalog/games/mtg/sets') ? json(sets) : undefined));
    renderApp(<GameSets />);
    await screen.findByText('3 Sets');
    expect(screen.getAllByText('Magic: The Gathering').length).toBeGreaterThan(1);
    fireEvent.click(screen.getByRole('radio', { name: 'Name' }));
    expect(screen.getByRole('group', { name: 'Sets von Magic: The Gathering' })).toBeTruthy();
  });

  it('shows loading, empty and error states', async () => {
    let answer = () => json({ game: 'mtg', sets: [] });
    fakeApi((c) => (c.path.startsWith('/catalog/games/mtg/sets') ? answer() : undefined));
    const { unmount } = renderApp(<SetList game="mtg" />);
    expect(screen.getByText('Lädt …')).toBeTruthy();
    expect(
      await screen.findByText('Für dieses Spiel sind noch keine Sets importiert.'),
    ).toBeTruthy();
    unmount();
    answer = () => error(500);
    renderApp(<SetList game="mtg" />);
    expect(await screen.findByRole('alert')).toBeTruthy();
  });

  it('says not found for an unknown game', async () => {
    vi.mocked(useLocalSearchParams).mockReturnValue({ game: 'chess' });
    fakeApi();
    renderApp(<GameSets />);
    expect((await screen.findAllByText('Das gibt es hier nicht.')).length).toBeGreaterThan(0);
  });
});

describe('home', () => {
  it('shows the recently viewed sets and cards, newest first, linking to them', async () => {
    fakeApi((c) =>
      c.path === '/catalog/games'
        ? json({ games: [{ id: 'mtg', name: 'Magic', setCount: 3 }] })
        : undefined,
    );
    recordRecent({ kind: 'set', game: 'mtg', code: 'mid', name: 'Innistrad: Midnight Hunt' });
    recordRecent({ kind: 'card', game: 'pokemon', id: 'abc', name: 'Pikachu' });
    renderApp(<Home />);
    const list = within(await screen.findByRole('region', { name: 'Zuletzt angesehen' }));
    const links = list.getAllByRole('link');
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/cards/abc', '/mtg/sets/mid']);
    expect(links[0]?.textContent).toContain('Pikachu');
  });

  it('has no recent row on a fresh device, and a search entry', () => {
    fakeApi();
    renderApp(<Home />);
    expect(screen.queryByRole('region', { name: 'Zuletzt angesehen' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Suchen' })).toBeTruthy();
  });
});
