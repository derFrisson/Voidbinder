import { fireEvent, screen } from '@testing-library/react';
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
});
