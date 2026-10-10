import { screen } from '@testing-library/react';
import type { SearchHit } from '@voidbinder/shared/api';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../../../test/fake-api';
import { PrintTile } from './PrintTile';

const hit = (marketPrice: SearchHit['marketPrice']): SearchHit => ({
  id: '59fab2d4-9883-4683-ad59-075a5bce6120',
  cardId: '2d112e72-f8b2-48e0-9798-208873db6761',
  number: '1',
  variant: '',
  name: 'Adeline, Resplendent Cathar',
  rarity: 'rare',
  finishes: ['normal', 'foil'],
  imageUrl: null,
  marketPrice,
  game: 'mtg',
  setCode: 'mid',
  setName: 'Innistrad: Midnight Hunt',
});

describe('PrintTile', () => {
  it('shows the market price with its source and the day it was observed, like the set page', () => {
    renderApp(
      <PrintTile
        hit={hit({
          source: 'tcgplayer',
          finish: 'normal',
          currency: 'USD',
          cents: 402,
          observedAt: '2026-10-09T20:05:19.000Z',
        })}
      />,
    );
    expect(screen.getByText(/4,02/)).toBeTruthy();
    expect(screen.getByText('TCGplayer, Stand 09.10.2026')).toBeTruthy();
  });

  it('shows no number for a print without a price', () => {
    renderApp(<PrintTile hit={hit(null)} />);
    expect(screen.queryByText(/€|\$/)).toBeNull();
  });
});
