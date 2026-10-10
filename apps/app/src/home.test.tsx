import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fakeApi, json, renderApp } from '../test/fake-api';
import Home from './app/index';

describe('home', () => {
  it('shows an error with retry when the games fail to load, tiles stay', async () => {
    let fail = true;
    fakeApi((c) =>
      c.path === '/catalog/games'
        ? fail
          ? json({ error: { code: 'x', message: 'x', requestId: 'r' } }, 500)
          : json({ games: [{ id: 'pokemon', setCount: 3 }] })
        : undefined,
    );
    renderApp(<Home />);
    await screen.findByRole('alert');
    expect(screen.getByText('Pokémon')).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(await screen.findByText('3 Sets')).toBeTruthy();
  });

  it('links the sets new in the catalog, in the browsing language (VB-83)', async () => {
    const calls = fakeApi((c) =>
      c.path.startsWith('/catalog/sets/new')
        ? json({
            sets: [
              {
                game: 'yugioh',
                code: 'rota',
                name: 'Rage of the Abyss',
                localizedName: 'Wut des Abgrunds',
                releasedOn: '2026-10-02',
                cardCount: 100,
                kind: null,
              },
              {
                game: 'pokemon',
                code: 'svp',
                name: 'Promos',
                localizedName: null,
                releasedOn: null,
                cardCount: null,
                kind: null,
              },
            ],
          })
        : undefined,
    );
    renderApp(<Home />);
    const region = await screen.findByRole('region', { name: 'Neu im Katalog' });
    const links = within(region).getAllByRole('link');
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/yugioh/sets/rota',
      '/pokemon/sets/svp',
    ]);
    expect(within(region).getByText('Yu‑Gi‑Oh! · 02.10.2026')).toBeTruthy();
    expect(within(region).getByText('Wut des Abgrunds')).toBeTruthy();
    expect(calls.some((c) => c.path === '/catalog/sets/new?lang=de')).toBe(true);
  });

  it('shows no section when nothing is new', async () => {
    fakeApi((c) => (c.path.startsWith('/catalog/sets/new') ? json({ sets: [] }) : undefined));
    renderApp(<Home />);
    await screen.findByText('Pokémon');
    expect(screen.queryByRole('region', { name: 'Neu im Katalog' })).toBeNull();
  });
});
