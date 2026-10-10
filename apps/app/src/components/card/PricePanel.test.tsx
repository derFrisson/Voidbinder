import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fakeApi, json, renderApp, type Call } from '../../../test/fake-api';
import type { PrintPricesResponse } from '@voidbinder/shared/api';
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
    renderApp(<PricePanel printId={PRINT} finishes={['normal', 'foil']} lang="en" />);
    expect(await screen.findByText('Für diesen Druck gibt es noch keine Preise.')).toBeTruthy();
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.queryByText(/€|\$/)).toBeNull();
  });

  it('shows both sources with source, finish, condition and date, no language', async () => {
    api();
    renderApp(<PricePanel printId={PRINT} finishes={['normal', 'foil']} lang="en" />);
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
    renderApp(<PricePanel printId={PRINT} finishes={['normal', 'foil']} lang="en" />);
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
    renderApp(<PricePanel printId={PRINT} finishes={['normal', 'foil']} lang="en" />);
    await screen.findByText(/^Cardmarket \(via Scryfall\) · Normal/);
    fireEvent.click(screen.getByRole('radio', { name: 'Foil' }));
    expect(await screen.findByText(/^Cardmarket \(via Scryfall\) · Foil/)).toBeTruthy();
    // Foil has only the observed NM: nothing to call an estimate, so no estimates sentence.
    expect(screen.queryByText(/Schätzungen/)).toBeNull();
    expect(calls.map((c) => c.path)).toContain(
      `/catalog/prints/${PRINT}/prices?currency=EUR&lang=en&finish=foil`,
    );
  });

  it('draws the daily points of the range and says when there are too few', async () => {
    const calls = api();
    renderApp(<PricePanel printId={PRINT} finishes={['normal', 'foil']} lang="en" />);
    // The first and last point with their dates and the source.
    expect(await screen.findByText('01.10.2026 · 3,20 €')).toBeTruthy();
    expect(screen.getByText('03.10.2026 · 3,34 €')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('Verlauf · Cardmarket');
    fireEvent.click(screen.getByRole('radio', { name: '30 T' }));
    await screen.findByText('01.10.2026 · 3,20 €');
    expect(calls.map((c) => c.path)).toContain(
      `/catalog/prints/${PRINT}/prices/history?days=30&lang=en`,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Foil' }));
    expect(await screen.findByText('01.10.2026 · 5,00 €')).toBeTruthy();
  });
});

// Yu-Gi-Oh! (MP25 EN301): TCGplayer files its prices under the edition, so the rows are
// `first_edition` while the catalog print says `normal`; Cardmarket has none.
const firstEdition: PrintPricesResponse = {
  printId: PRINT,
  prices: [
    {
      source: 'tcgplayer',
      sourceLabel: 'TCGplayer (via TCGCSV)',
      finish: 'first_edition',
      lang: 'en',
      currency: 'USD',
      market: 23,
      low: 10,
      mid: null,
      high: null,
      observedAt: '2026-10-09T20:05:19.000Z',
    },
  ],
  display: {
    source: 'tcgplayer',
    finish: 'first_edition',
    lang: 'en',
    currency: 'USD',
    cents: 23,
    observedAt: '2026-10-09T20:05:19.000Z',
  },
  conditions: [
    { condition: 'NM', factor: 1, cents: 23 },
    { condition: 'EX', factor: 0.85, cents: 20 },
    { condition: 'GD', factor: 0.7, cents: 16 },
    { condition: 'LP', factor: 0.6, cents: 14 },
    { condition: 'PL', factor: 0.45, cents: 10 },
    { condition: 'PO', factor: 0.3, cents: 7 },
  ],
  conditionsAreEstimates: true,
};

describe('PricePanel, prices filed under a finish the print does not list', () => {
  it('starts at the finish of the display price and shows its rows, not "kein Preis"', async () => {
    const calls = api(firstEdition);
    renderApp(<PricePanel printId={PRINT} finishes={['normal']} lang="en" />);
    expect(
      await screen.findByText(
        /^TCGplayer \(via TCGCSV\) · 1\. Auflage · Near Mint · Stand 09\.10\.2026/,
      ),
    ).toBeTruthy();
    // The tile and the condition row's NM.
    expect(screen.getAllByText(/0,23/)).toHaveLength(2);
    // The first read asks without a finish: the API's display price decides.
    expect(calls.map((c) => c.path)).toContain(
      `/catalog/prints/${PRINT}/prices?currency=EUR&lang=en`,
    );
    // The selector offers the print's finish and the one the prices are filed under.
    expect(screen.getByRole('radio', { name: '1. Auflage' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(screen.getByRole('radio', { name: 'Normal' }).getAttribute('aria-checked')).toBe(
      'false',
    );
    // The condition row is the display price's: NM 0,23.
    const row = screen.getByRole('group', { name: 'Zustand' });
    expect(within(row).getByText(/0,23/)).toBeTruthy();
    expect(screen.getByText(/^Basis: TCGplayer, 1\. Auflage/)).toBeTruthy();
  });

  it('hides the source without a row for any finish, and says so only when none has one', async () => {
    api(firstEdition);
    renderApp(<PricePanel printId={PRINT} finishes={['normal']} lang="en" />);
    await screen.findByText(/^TCGplayer \(via TCGCSV\)/);
    expect(screen.queryByText('Cardmarket')).toBeNull();
    expect(screen.queryByText('kein Preis')).toBeNull();
  });

  it('keeps a source that has rows for another finish, saying it has no price for this one', async () => {
    api();
    renderApp(<PricePanel printId={PRINT} finishes={['normal', 'foil']} lang="en" />);
    await screen.findByText(/^Cardmarket \(via Scryfall\) · Normal/);
    // Cardmarket and TCGplayer both have rows: both tiles stay.
    expect(screen.getByText('Cardmarket')).toBeTruthy();
    expect(screen.getByText('TCGplayer')).toBeTruthy();
  });

  it('shows the strip price of the display finish', async () => {
    api(firstEdition);
    renderApp(<PriceStrip printId={PRINT} lang="en" />);
    expect(await screen.findByText(/0,23/)).toBeTruthy();
    expect(screen.queryByText('Cardmarket')).toBeNull();
    expect(screen.queryByText('–')).toBeNull();
  });
});

describe('PricePanel, estimates sentence', () => {
  it('is left out when every visible grade is the observed price', async () => {
    api({ ...printPrices, conditions: [{ condition: 'NM', factor: 1, cents: 334 }] });
    renderApp(<PricePanel printId={PRINT} finishes={['normal']} lang="en" />);
    await screen.findByRole('group', { name: 'Zustand' });
    expect(screen.queryByText(/^Basis:/)).toBeNull();
  });
});

describe('PricePanel, failed read', () => {
  it('shows an error state with a retry instead of "no prices yet"', async () => {
    let fail = true;
    fakeApi(
      (c) =>
        c.path.startsWith(`/catalog/prints/${PRINT}/prices?`)
          ? fail
            ? json({ error: { code: 'internal', message: 'x', requestId: 'r' } }, 500)
            : json(printPrices)
          : undefined,
      (c) =>
        c.path.startsWith(`/catalog/prints/${PRINT}/prices/history`) ? json(history) : undefined,
    );
    renderApp(<PricePanel printId={PRINT} finishes={['normal', 'foil']} lang="en" />);
    expect(await screen.findByText(/^Das hat nicht geklappt/)).toBeTruthy();
    expect(screen.queryByText('Für diesen Druck gibt es noch keine Preise.')).toBeNull();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(await screen.findByText(/^Cardmarket \(via Scryfall\) · Normal/)).toBeTruthy();
    expect(screen.queryByText(/^Das hat nicht geklappt/)).toBeNull();
  });
});

describe('PricePanel, more conditions', () => {
  it('shows LP, PL and PO as estimates behind a toggle', async () => {
    api(firstEdition);
    renderApp(<PricePanel printId={PRINT} finishes={['normal']} lang="en" />);
    const row = await screen.findByRole('group', { name: 'Zustand' });
    expect(within(row).queryByText('LP')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Mehr Zustände' }));
    expect(
      within(row)
        .getAllByText(/^(NM|EX|GD|LP|PL|PO)$/)
        .map((e) => e.textContent),
    ).toEqual(['NM', 'EX', 'GD', 'LP', 'PL', 'PO']);
    expect(within(row).getByText(/0,07/).textContent).toMatch(/^≈/);
    expect(screen.getByText(/EX, GD, LP, PL und PO sind Schätzungen/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Weniger Zustände' }));
    expect(within(row).queryByText('LP')).toBeNull();
  });
});

describe('PriceStrip', () => {
  it('shows the two market prices, a dash for a source without one', async () => {
    api();
    renderApp(<PriceStrip printId={PRINT} lang="en" />);
    expect(await screen.findByText(/3,34/)).toBeTruthy();
    expect(screen.getByText(/4,02/)).toBeTruthy();
  });

  it('shows dashes while there is no price', () => {
    fakeApi();
    renderApp(<PriceStrip printId={PRINT} lang="en" />);
    expect(screen.getAllByText('–')).toHaveLength(2);
  });
});
