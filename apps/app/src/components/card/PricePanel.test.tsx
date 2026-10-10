import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fakeApi, renderApp } from '../../../test/fake-api';
import type { Price, PrintPrices } from '../../api/queries/cards';
import { PricePanel } from './PricePanel';

const price = (p: Partial<Price> & Pick<Price, 'lang' | 'finish' | 'market'>): Price => ({
  source: 'cardmarket',
  currency: 'EUR',
  low: null,
  observedAt: '2026-10-09T12:00:00Z',
  ...p,
});
const prices: PrintPrices = {
  prices: [
    price({ lang: 'de', finish: 'normal', market: 250 }),
    price({ lang: 'en', finish: 'normal', market: 400 }),
    price({ lang: 'de', finish: 'foil', market: 900 }),
  ],
  conditions: [],
  currency: 'EUR',
};

const mocked = vi.hoisted(() => ({ prices: null as unknown }));
vi.mock('../../api/queries/cards', async (orig) => ({
  ...(await orig<typeof import('../../api/queries/cards')>()),
  usePrintPrices: () => mocked.prices,
}));

describe('PricePanel', () => {
  it('shows no controls and no number while prices are absent', () => {
    mocked.prices = null;
    fakeApi();
    renderApp(<PricePanel printId="p1" finishes={['normal', 'foil']} />);
    expect(screen.getByText('Für diesen Druck gibt es noch keine Preise.')).toBeTruthy();
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  it('leads the when line with the language and switches it with the DE/EN control', () => {
    mocked.prices = prices;
    fakeApi();
    renderApp(<PricePanel printId="p1" finishes={['normal', 'foil']} />);
    // The app speaks German: the German price first, "DE · Normal · Near Mint · Stand …".
    expect(screen.getByText(/^DE · Normal · Near Mint · Stand /)).toBeTruthy();
    expect(screen.getByText(/2,50/)).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'EN' }));
    expect(screen.getByText(/^EN · Normal · Near Mint · Stand /)).toBeTruthy();
    expect(screen.getByText(/4,00/)).toBeTruthy();
    // No English foil price: the source says so.
    fireEvent.click(screen.getByRole('radio', { name: 'Foil' }));
    expect(screen.getAllByText('kein Preis').length).toBe(2);
  });
});
