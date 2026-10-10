import { screen } from '@testing-library/react';
import { useLocalSearchParams } from 'expo-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, json, renderApp } from '../../../test/fake-api';
import type { Card, PrintDetail } from '@voidbinder/shared/api';
import CardPage from '../../app/cards/[id]';
import { de } from '../../i18n/de';
import { attributeChips } from './attributes';

const CARD = '2d112e72-f8b2-48e0-9798-208873db6761';
const print = (id: string, set: string, number: string, langs: string[]) => ({
  id,
  cardId: CARD,
  set: { game: 'mtg', code: set, name: set === 'mid' ? 'Innistrad: Midnight Hunt' : 'The List' },
  number,
  variant: '',
  rarity: 'rare',
  finishes: ['normal', 'foil'],
  artist: 'Joseph Meehan',
  releasedOn: '2021-09-24',
  imageUrl: `https://img.voidbinder.de/images/mtg/${id}/en/sm.webp`,
  externalIds: {},
  localizations: langs.map((lang) => ({
    lang,
    name: lang === 'de' ? 'Adeline, strahlende Katharerin' : 'Adeline, Resplendent Cathar',
    text: lang === 'de' ? 'Wachsamkeit' : 'Vigilance',
    imageUrl: null,
  })),
});
const card = {
  card: {
    id: CARD,
    game: 'mtg',
    name: 'Adeline, Resplendent Cathar',
    typeLine: 'Legendary Creature — Human Knight',
    text: 'Vigilance',
    attributes: { cmc: 3, mana_cost: '{1}{W}{W}', power: '*', toughness: '4', colors: ['W'] },
    legalities: { commander: 'legal', standard: 'not_legal', pauper: 'banned' },
  },
  prints: [
    print('11111111-1111-4111-8111-111111111111', 'plst', 'MID-1', ['en']),
    print('22222222-2222-4222-8222-222222222222', 'mid', '1', ['de', 'en']),
  ],
  copyright: '©Wizards of the Coast LLC',
};

describe('attributeChips', () => {
  it('lists the game attributes, then rarity and release', () => {
    const chips = attributeChips(card.card as Card, card.prints[1] as PrintDetail, de, 'de');
    expect(chips.map((c) => `${c.label} ${c.value}`)).toEqual([
      'Manakosten {1}{W}{W}',
      'Manawert 3',
      'Stärke/Widerstand */4',
      'Farbe Weiß',
      'Seltenheit Selten',
      'Erschienen 24.09.2021',
    ]);
    const yugioh = {
      ...card.card,
      game: 'yugioh',
      attributes: { atk: 2500, def: 2100, level: 7, attribute: 'DARK' },
    };
    expect(attributeChips(yugioh as Card, undefined, de, 'de').map((c) => c.value)).toEqual([
      '2500/2100',
      '7',
      'DARK',
    ]);
    const pokemon = {
      ...card.card,
      game: 'pokemon',
      attributes: { hp: 60, types: ['Fire'], stage: 'Basic' },
    };
    expect(attributeChips(pokemon as Card, undefined, de, 'de').map((c) => c.label)).toEqual([
      'KP',
      'Typ',
      'Phase',
    ]);
  });
});

// jsdom has no width, so the page renders its phone layout.
describe('card page', () => {
  beforeEach(() => vi.mocked(useLocalSearchParams).mockReturnValue({ id: CARD }));

  it('shows loading, then the card in German with attributes, legality and no prices', async () => {
    fakeApi((c) => (c.path === `/catalog/cards/${CARD}` ? json(card) : undefined));
    renderApp(<CardPage />);
    expect(screen.getByText('Lädt …')).toBeTruthy();
    // The German name from the print that has one, the text in German.
    expect((await screen.findAllByText('Adeline, strahlende Katharerin')).length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText('Wachsamkeit')).toBeTruthy();
    expect(screen.getByText('gebannt')).toBeTruthy();
    // VB-30 is not merged: the panel says so, no number anywhere.
    expect(screen.getByText('Für diesen Druck gibt es noch keine Preise.')).toBeTruthy();
    expect(screen.queryByText(/€|\$/)).toBeNull();
    // Signed out, the collection buttons lead to sign-in and say so.
    expect(screen.getByRole('button', { name: '+ In Sammlung' })).toBeTruthy();
    expect(screen.getByText('Melde dich an, um Karten zu sammeln.')).toBeTruthy();
    // Rights: Wizards' notice, artist with the copyright line, Scryfall.
    expect(screen.getByText(/Fan Content Policy/)).toBeTruthy();
    expect(
      screen.getByText('Illustration: Joseph Meehan · ©Wizards of the Coast LLC'),
    ).toBeTruthy();
    expect(screen.getByText(/über Scryfall/)).toBeTruthy();
    expect(screen.getAllByRole('row')).toHaveLength(3);
  });

  it('shows the print from the URL', async () => {
    vi.mocked(useLocalSearchParams).mockReturnValue({ id: CARD, print: card.prints[1]?.id ?? '' });
    fakeApi((c) => (c.path === `/catalog/cards/${CARD}` ? json(card) : undefined));
    renderApp(<CardPage />);
    expect(await screen.findByText('MID 1')).toBeTruthy();
    expect(screen.getByRole('row', { current: true }).textContent).toContain('Midnight Hunt');
  });

  it('says not found for an unknown card', async () => {
    fakeApi();
    renderApp(<CardPage />);
    expect(await screen.findByText('Das gibt es hier nicht.')).toBeTruthy();
  });
});
