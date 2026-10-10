import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { fakeApi, json, me, type Call } from '../../../test/fake-api';
import { history, noPrices, PRINT, printPrices } from '../../../test/prices';
import { usePriceHistory, usePrintPrices } from './cards';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const usd = (c: Call) => (c.path === '/me' ? json({ ...me, currency: 'USD' }) : undefined);
const prices = (c: Call) =>
  c.path.startsWith(`/catalog/prints/${PRINT}/prices?`) ? json(printPrices) : undefined;
const past = (c: Call) =>
  c.path.startsWith(`/catalog/prints/${PRINT}/prices/history`) ? json(history) : undefined;

describe('usePrintPrices', () => {
  it('reads the prices in EUR when signed out, with the finish of the estimates', async () => {
    const calls = fakeApi(prices);
    const { result } = renderHook(() => usePrintPrices(PRINT, 'foil'), { wrapper });
    await waitFor(() => expect(result.current.prices).toEqual(printPrices));
    expect(calls.map((c) => c.path)).toContain(
      `/catalog/prints/${PRINT}/prices?currency=EUR&finish=foil`,
    );
  });

  it("asks in the profile's currency, once the session is known", async () => {
    const calls = fakeApi(usd, prices);
    const { result } = renderHook(() => usePrintPrices(PRINT), { wrapper });
    await waitFor(() => expect(result.current.prices).not.toBeNull());
    const reads = calls.filter((c) => c.path.startsWith('/catalog/'));
    expect(reads.map((c) => c.path)).toEqual([`/catalog/prints/${PRINT}/prices?currency=USD`]);
  });

  it('is null for a print without a price row, for an unknown print and without an id', async () => {
    fakeApi((c) => (c.path.startsWith('/catalog/prints/') ? json(noPrices) : undefined));
    const empty = renderHook(() => usePrintPrices(PRINT), { wrapper });
    const none = renderHook(() => usePrintPrices(undefined), { wrapper });
    await waitFor(() => expect(empty.result.current.prices).toBeNull());
    expect(none.result.current.prices).toBeNull();

    const calls = fakeApi();
    const unknown = renderHook(() => usePrintPrices(PRINT), { wrapper });
    await waitFor(() =>
      expect(calls.some((c) => c.path.startsWith('/catalog/prints/'))).toBe(true),
    );
    await waitFor(() => expect(unknown.result.current.prices).toBeNull());
    // An unknown print (404) is "no prices", not a failure to retry.
    expect(unknown.result.current.failed).toBe(false);
  });

  it('tells a failed read (500) from a print without prices, and asks again on retry', async () => {
    let fail = true;
    fakeApi((c) =>
      c.path.startsWith(`/catalog/prints/${PRINT}/prices?`)
        ? fail
          ? json({ error: { code: 'internal', message: 'x', requestId: 'r' } }, 500)
          : json(printPrices)
        : undefined,
    );
    const { result } = renderHook(() => usePrintPrices(PRINT), { wrapper });
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.prices).toBeNull();
    fail = false;
    result.current.retry();
    await waitFor(() => expect(result.current.prices).toEqual(printPrices));
    expect(result.current.failed).toBe(false);
  });
});

describe('usePriceHistory', () => {
  it('maps the series of the finish from the source the currency prefers', async () => {
    const calls = fakeApi(past);
    const { result } = renderHook(() => usePriceHistory(PRINT, 30, 'normal'), { wrapper });
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current).toMatchObject({
      source: 'cardmarket',
      currency: 'EUR',
      finish: 'normal',
      points: [
        { date: '2026-10-01', cents: 320 },
        { date: '2026-10-02', cents: 330 },
        { date: '2026-10-03', cents: 334 },
      ],
    });
    expect(calls.at(-1)?.path).toBe(`/catalog/prints/${PRINT}/prices/history?days=30`);
  });

  it('takes TCGCSV before the Scryfall copy for a USD profile', async () => {
    fakeApi(usd, past);
    const { result } = renderHook(() => usePriceHistory(PRINT, 90, 'normal'), { wrapper });
    await waitFor(() => expect(result.current?.source).toBe('tcgplayer'));
    expect(result.current?.currency).toBe('USD');
  });

  it('is null when the finish has no series', async () => {
    const calls = fakeApi(past);
    const { result } = renderHook(() => usePriceHistory(PRINT, 90, 'etched'), { wrapper });
    await waitFor(() => expect(calls.some((c) => c.path.includes('/history'))).toBe(true));
    expect(result.current).toBeNull();
  });
});
