import { screen } from '@testing-library/react';
import type { SearchHit } from '@voidbinder/shared/api';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../../../test/fake-api';
import { PrintTile } from './PrintTile';

const hit = (marketPrice: SearchHit['marketPrice']): SearchHit => ({
  id: '59fab2d4-9883-4683-ad59-075a5bce6120',
  cardId: '2d112e72-f8b2-48e0-9798-208873db6761',
  number: '1',
  displayNumber: '1',
  displayCode: 'MID 1',
  cardFormat: 'standard',
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
        lang="en"
        hit={hit({
          source: 'tcgplayer',
          finish: 'normal',
          lang: 'en',
          currency: 'USD',
          cents: 402,
          observedAt: '2026-10-09T20:05:19.000Z',
        })}
      />,
    );
    expect(screen.getByText(/4,02/)).toBeTruthy();
    expect(screen.getByText('TCGplayer, Stand 09.10.2026')).toBeTruthy();
  });

  it('marks a price for copies in another language than the hit shows, only then (VB-103)', () => {
    const price = {
      source: 'cardmarket' as const,
      finish: 'normal',
      lang: 'en',
      currency: 'EUR' as const,
      cents: 334,
      observedAt: '2026-10-10T03:00:00.000Z',
    };
    const { unmount } = renderApp(<PrintTile hit={hit(price)} lang="de" />);
    expect(screen.getByLabelText('Preis für EN-Karten').textContent).toBe('EN');
    unmount();
    renderApp(<PrintTile hit={hit({ ...price, lang: 'de' })} lang="de" />);
    expect(screen.queryByLabelText(/Preis für/)).toBeNull();
    expect(screen.queryByText('DE')).toBeNull();
  });

  it('shows no number for a print without a price', () => {
    renderApp(<PrintTile hit={hit(null)} lang="en" />);
    expect(screen.queryByText(/€|\$/)).toBeNull();
  });
});

describe('PrintTile, Yu-Gi-Oh! (VB-97)', () => {
  it('shows the number in the language searched for and boxes the picture at 59:86', () => {
    const { container } = renderApp(
      <PrintTile
        lang="en"
        hit={{
          ...hit(null),
          game: 'yugioh',
          setCode: 'blgg',
          number: 'EN024',
          displayNumber: 'DE024',
          displayCode: 'BLGG-DE024',
          matchedCode: 'BLGG-DE024',
          cardFormat: 'japanese',
          imageUrl: 'https://img.voidbinder.de/images/yugioh/34950192/en/sm.webp',
        }}
      />,
    );
    expect(screen.getByText('BLGG DE024')).toBeTruthy();
    expect(screen.getByLabelText(/BLGG DE024 \(Nummer in DE\)$/)).toBeTruthy();
    const box = container.querySelector('[style*="aspect-ratio"]') as HTMLElement;
    expect(box.style.aspectRatio).toBe(`${59 / 86} / 1`);
    // Contained, so no edge of the card is cut.
    const picture = box.querySelector('[style*="background-image"]') as HTMLElement;
    expect(getComputedStyle(picture).backgroundSize).toBe('contain');
  });
});
