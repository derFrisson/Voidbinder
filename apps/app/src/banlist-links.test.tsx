import { screen } from '@testing-library/react';
import { useLocalSearchParams } from 'expo-router';
import { describe, expect, it, vi } from 'vitest';
import { fakeApi, json, renderApp } from '../test/fake-api';
import BanlistPage from './app/[game]/banlist';

const card = {
  id: '10000000-0000-4000-8000-000000000001',
  name: 'Pot of Greed',
  printId: '20000000-0000-4000-8000-000000000001',
  imageUrl: null,
  width: null,
  height: null,
  setCode: 'lob',
  number: 'EN019',
  displayNumber: 'DE019',
  cardFormat: 'standard',
};

describe('ban list links (VB-107)', () => {
  it.each([
    [{}, ''],
    [{ lang: 'en' }, '&lang=en'],
  ])('opens the listed print, ?lang= only when not the user’s: %j', async (params, lang) => {
    vi.mocked(useLocalSearchParams).mockReturnValue({ game: 'yugioh', ...params });
    fakeApi((c) =>
      c.path.startsWith('/catalog/banlist/yugioh')
        ? json({
            format: 'tcg',
            effectiveDate: null,
            asOf: null,
            groups: { forbidden: [card], limited: [], semiLimited: [] },
            changes: [],
          })
        : undefined,
    );
    renderApp(<BanlistPage />);
    const link = await screen.findByRole('link', { name: /Pot of Greed/ });
    expect(link.getAttribute('href')).toBe(`/cards/${card.id}?print=${card.printId}${lang}`);
    vi.mocked(useLocalSearchParams).mockReturnValue({});
  });
});
