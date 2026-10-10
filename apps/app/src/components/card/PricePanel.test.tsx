import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fakeApi, json, renderApp, type Call } from '../../../test/fake-api';
import { history, noPrices, PRINT, printPrices } from '../../../test/prices';
import { PricePanel, PriceStrip } from './PricePanel';

const api = (prices: unknown = printPrices) => {
  const calls: Call[] = fakeApi(
    (c) =>
      c.path.startsWith(`/catalog/prints/${PRINT}/prices?`)
        ? json(
            c.path.includes('finish=foil')
              ? {
                  ...printPrices,
                  display: { ...printPrices.display, finish: 'foil', cents: 523 },
                  conditions: [{ condition: 'NM', factor: 1, cents: 523 }],
                }
              : prices,
          )
        : undefined,
    (c) =>
      c.path.startsWith(`/catalog/prints/${PRINT}/prices/history`) ? json(history) : undefined,
  );
  return calls;
};

describe('PricePanel', () => {
  it('shows no controls and no number for a print without prices', async () => {
    api(noPrices);
    renderApp(<PricePanel printId={PRINT} finishes={['normal', 'foil']} />);
    expect(await screen.findByText('Für diesen Druck gibt es noch keine Preise.')).toBeTruthy();
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.queryByText(/€|\$/)).toBeNull();
  });

  it('shows both sources with source, finish, condition and date, no language', async () => {
    api();
    renderApp(<PricePanel printId={PRINT} finishes={['normal', 'foil']} />);
    // Cardmarket's trend in EUR, TCGplayer's market price in USD (the TCGCSV row, with its low).
    expect(
      await screen.findAllByText(
        /^Cardmarket \(via Scryfall\) · Normal · Near Mint · Stand 10\.10\.2026/,
      ),
    ).toHaveLength(1);
    expect(
      screen.getAllByText(/^TCGplayer \(via TCGCSV\) · Normal · Near Mint · Stand 09\.10\.2026/),
    ).toHaveLength(1);
    expect(screen.getByText(/4,02/)).toBeTruthy();
    expect(screen.getByText(/2,50/)).toBeTruthy();
    expect(screen.queryByRole('radio', { name: 'DE' })).toBeNull();
  });

  it('shows NM as is, EX and GD as estimates (≈), and says what they are based on', async () => {
    api();
    renderApp(<PricePanel printId={PRINT} finishes={['normal', 'foil']} />);
    const row = await screen.findByRole('group', { name: 'Zustand' });
    expect(
      within(row)
        .getAllByText(/^(NM|EX|GD)$/)
        .map((e) => e.textContent),
    ).toEqual(['NM', 'EX', 'GD']);
    expect(within(row).getByText(/3,34/).textContent).not.toContain('≈');
    expect(within(row).getByText(/2,84/).textContent).toMatch(/^≈/);
    expect(within(row).getByText(/2,34/).textContent).toMatch(/^≈/);
    // LP is not in the row.
    expect(within(row).queryByText(/2,00/)).toBeNull();
    expect(screen.getByText(/^Basis: Cardmarket, Normal\. EX und GD/)).toBeTruthy();
  });

  it('switches the finish and asks again for its estimates', async () => {
    const calls = api();
    renderApp(<PricePanel printId={PRINT} finishes={['normal', 'foil']} />);
    await screen.findByText(/^Cardmarket \(via Scryfall\) · Normal/);
    fireEvent.click(screen.getByRole('radio', { name: 'Foil' }));
    expect(await screen.findByText(/^Cardmarket \(via Scryfall\) · Foil/)).toBeTruthy();
    expect(await screen.findByText(/^Basis: Cardmarket, Foil/)).toBeTruthy();
    expect(calls.map((c) => c.path)).toContain(
      `/catalog/prints/${PRINT}/prices?currency=EUR&finish=foil`,
    );
  });

  it('draws the daily points of the range and says when there are too few', async () => {
    const calls = api();
    renderApp(<PricePanel printId={PRINT} finishes={['normal', 'foil']} />);
    // The first and last point with their dates and the source.
    expect(await screen.findByText('01.10.2026 · 3,20 €')).toBeTruthy();
    expect(screen.getByText('03.10.2026 · 3,34 €')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('Verlauf · Cardmarket');
    fireEvent.click(screen.getByRole('radio', { name: '30 T' }));
    await screen.findByText('01.10.2026 · 3,20 €');
    expect(calls.map((c) => c.path)).toContain(`/catalog/prints/${PRINT}/prices/history?days=30`);
    fireEvent.click(screen.getByRole('radio', { name: 'Foil' }));
    expect(await screen.findByText('01.10.2026 · 5,00 €')).toBeTruthy();
  });
});

describe('PriceStrip', () => {
  it('shows the two market prices, a dash for a source without one', async () => {
    api();
    renderApp(<PriceStrip printId={PRINT} finish="normal" />);
    expect(await screen.findByText(/3,34/)).toBeTruthy();
    expect(screen.getByText(/4,02/)).toBeTruthy();
  });

  it('shows dashes while there is no price', () => {
    fakeApi();
    renderApp(<PriceStrip printId={PRINT} finish="normal" />);
    expect(screen.getAllByText('–')).toHaveLength(2);
  });
});
