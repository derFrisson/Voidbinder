import { screen, within } from '@testing-library/react';
import { useLocalSearchParams } from 'expo-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, json, me, renderApp } from '../../../test/fake-api';
import type { Card, PrintDetail } from '@voidbinder/shared/api';
import CardPage from '../../app/cards/[id]';
import { printPrices } from '../../../test/prices';
import { de } from '../../i18n/de';
import { attributeChips } from './attributes';
import { Legality } from './CardPanels';

const CARD = '2d112e72-f8b2-48e0-9798-208873db6761';
const print = (id: string, set: string, number: string, langs: string[]) => ({
  id,
  cardId: CARD,
  set: { game: 'mtg', code: set, name: set === 'mid' ? 'Innistrad: Midnight Hunt' : 'The List' },
  number,
  displayNumber: number,
  displayCode: `${set.toUpperCase()} ${number}`,
  cardFormat: 'standard',
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
    displayNumber: number,
    displayCode: `${set.toUpperCase()} ${number}`,
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
    fakeApi((c) => (c.path.startsWith(`/catalog/cards/${CARD}`) ? json(card) : undefined));
    renderApp(<CardPage />);
    expect(screen.getByText('Lädt …')).toBeTruthy();
    // The German name from the print that has one, the text in German.
    expect((await screen.findAllByText('Adeline, strahlende Katharerin')).length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText('Wachsamkeit')).toBeTruthy();
    expect(screen.getByText('gebannt')).toBeTruthy();
    // The price routes answer 404 here: the panel says so, no number anywhere.
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

  it('shows how many copies the Yu-Gi-Oh! lists allow next to the status', async () => {
    renderApp(<Legality game="yugioh" legalities={{ tcg: 'Limited', ocg: 'Forbidden' }} />);
    expect(await screen.findByText('limitiert')).toBeTruthy();
    expect(screen.getByText('1 Kopie')).toBeTruthy();
    expect(screen.getByText('verboten')).toBeTruthy();
    expect(screen.getByText('0 Kopien')).toBeTruthy();
  });

  it('puts the copies line with the format name, apart from the status (VB-100)', async () => {
    renderApp(<Legality game="yugioh" legalities={{ tcg: 'Semi-Limited', ocg: 'Limited' }} />);
    const copies = await screen.findByText('2 Kopien');
    // Name and copies share a wrapping group (a gap between them, or a second line); the status
    // chip is the group's sibling, right-aligned.
    const group = copies.parentElement;
    expect(group?.textContent).toBe('TCG2 Kopien');
    expect(group?.nextElementSibling?.textContent).toBe('semi-limitiert');
    expect(screen.getByText('1 Kopie').parentElement?.textContent).toBe('OCG1 Kopie');
  });

  it('shows no copies line for Magic', async () => {
    renderApp(<Legality game="mtg" legalities={{ standard: 'banned' }} />);
    expect(await screen.findByText('gebannt')).toBeTruthy();
    expect(screen.queryByText(/Kopie/)).toBeNull();
  });

  it('shows the real prices of the selected print in the price panel', async () => {
    const id = card.prints[0]?.id ?? '';
    fakeApi(
      (c) => (c.path.startsWith(`/catalog/cards/${CARD}`) ? json(card) : undefined),
      (c) =>
        c.path.startsWith(`/catalog/prints/${id}/prices?`)
          ? json({ ...printPrices, printId: id })
          : undefined,
    );
    renderApp(<CardPage />);
    expect(await screen.findByText(/^Cardmarket \(via Scryfall\) · Normal/)).toBeTruthy();
    expect(screen.queryByText('Für diesen Druck gibt es noch keine Preise.')).toBeNull();
  });

  it('prices the card in the language of ?lang=, marking a price of another (VB-103)', async () => {
    const id = card.prints[0]?.id ?? '';
    /** The API's answer when the print has prices in `langs`: the asked-for one, else the first. */
    const answer = (langs: string[]) =>
      fakeApi(
        (c) => (c.path.startsWith(`/catalog/cards/${CARD}`) ? json(card) : undefined),
        (c) => {
          if (!c.path.startsWith(`/catalog/prints/${id}/prices?`)) return undefined;
          const asked = new URLSearchParams(c.path.split('?')[1]).get('lang') ?? 'en';
          const lang = langs.includes(asked) ? asked : langs[0];
          return json({
            ...printPrices,
            printId: id,
            prices: printPrices.prices.map((p) => ({ ...p, lang })),
          });
        },
      );
    vi.mocked(useLocalSearchParams).mockReturnValue({ id: CARD, lang: 'en' });

    // An EN price exists: it shows, unmarked, though the profile is German.
    const calls = answer(['de', 'en']);
    const english = renderApp(<CardPage />);
    expect(await screen.findByText(/^Cardmarket \(via Scryfall\) · Normal/)).toBeTruthy();
    expect(screen.queryByLabelText(/Preis für/)).toBeNull();
    // English is the API's default: not sent, where the profile's German would be.
    expect(calls.map((c) => c.path)).toContain(`/catalog/cards/${CARD}`);
    expect(
      calls.some(
        (c) => c.path.startsWith(`/catalog/prints/${id}/prices?`) && c.path.includes('lang=en'),
      ),
    ).toBe(true);
    english.unmount();

    // Only a German one: it shows with its chip.
    answer(['de']);
    renderApp(<CardPage />);
    expect(await screen.findByText(/^Cardmarket \(via Scryfall\) · Normal/)).toBeTruthy();
    expect(screen.getAllByLabelText('Preis für DE-Karten').length).toBeGreaterThan(0);
  });

  it("fills the prints table's price column from each print's market price, with source and day", async () => {
    const priced = {
      ...card,
      prints: [
        {
          ...card.prints[0],
          marketPrice: {
            source: 'cardmarket',
            finish: 'normal',
            currency: 'EUR',
            cents: 334,
            observedAt: '2026-10-10T03:44:08.135Z',
          },
        },
        { ...card.prints[1], marketPrice: null },
      ],
    };
    fakeApi((c) => (c.path.startsWith(`/catalog/cards/${CARD}`) ? json(priced) : undefined));
    renderApp(<CardPage />);
    const rows = await screen.findAllByRole('row');
    expect(within(rows[1] as HTMLElement).getByText(/3,34/)).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText('Cardmarket, Stand 10.10.2026')).toBeTruthy();
    expect(within(rows[2] as HTMLElement).getByLabelText('kein Preis').textContent).toBe('–');
  });

  it("asks for the prints' prices in the profile currency, not sending the default EUR", async () => {
    const calls = fakeApi(
      (c) => (c.path === '/me' ? json({ ...me, currency: 'USD' }) : undefined),
      (c) => (c.path.startsWith(`/catalog/cards/${CARD}`) ? json(card) : undefined),
    );
    renderApp(<CardPage />);
    await screen.findByText('Wachsamkeit');
    expect(calls.filter((c) => c.path.startsWith('/catalog/cards/')).map((c) => c.path)).toEqual([
      `/catalog/cards/${CARD}?currency=USD&lang=de`,
    ]);
  });

  it('shows the language of ?lang= (a search hit’s match) over the profile language (VB-102)', async () => {
    const PRINT = card.prints[1]?.id ?? '';
    // Each language's own code, so the test sees which one shows.
    const coded = {
      ...card,
      prints: card.prints.map((p) => ({
        ...p,
        localizations: p.localizations.map((l) => ({
          ...l,
          displayCode: `MID ${l.lang.toUpperCase()}1`,
        })),
      })),
    };
    fakeApi((c) => (c.path.startsWith(`/catalog/cards/${CARD}`) ? json(coded) : undefined));
    vi.mocked(useLocalSearchParams).mockReturnValue({ id: CARD, print: PRINT, lang: 'en' });
    const english = renderApp(<CardPage />);
    expect(
      await screen.findByRole('heading', { name: 'Adeline, Resplendent Cathar' }),
    ).toBeTruthy();
    expect(screen.getByText('MID EN1')).toBeTruthy();
    expect(screen.getByText('Vigilance')).toBeTruthy();
    // Another print in the table keeps the language.
    expect(
      screen.getAllByRole('link').some((a) => a.getAttribute('href')?.endsWith('&lang=en')),
    ).toBe(true);
    english.unmount();

    // Without ?lang= the profile language (German) shows.
    vi.mocked(useLocalSearchParams).mockReturnValue({ id: CARD, print: PRINT });
    renderApp(<CardPage />);
    expect(
      await screen.findByRole('heading', { name: 'Adeline, strahlende Katharerin' }),
    ).toBeTruthy();
    expect(screen.getByText('MID DE1')).toBeTruthy();
    expect(screen.getByText('Wachsamkeit')).toBeTruthy();
  });

  it('shows the print from the URL', async () => {
    vi.mocked(useLocalSearchParams).mockReturnValue({ id: CARD, print: card.prints[1]?.id ?? '' });
    fakeApi((c) => (c.path.startsWith(`/catalog/cards/${CARD}`) ? json(card) : undefined));
    renderApp(<CardPage />);
    expect(await screen.findByText('MID 1')).toBeTruthy();
    expect(screen.getByRole('row', { current: true }).textContent).toContain('Midnight Hunt');
  });

  it('shows a Yu-Gi-Oh! code in the language shown, the stage in its card format (VB-97)', async () => {
    const ygo = {
      card: { ...card.card, game: 'yugioh', legalities: {} },
      prints: [
        {
          ...print('33333333-3333-4333-8333-333333333333', 'blgg', 'EN024', ['de', 'en']),
          set: { game: 'yugioh', code: 'blgg', name: 'Battles of Legend' },
          displayCode: 'BLGG-EN024',
          cardFormat: 'japanese',
          localizations: [
            { lang: 'de', name: 'Geistertrick-Engel', text: null, imageUrl: null },
            { lang: 'en', name: 'Ghostrick Angel', text: null, imageUrl: null },
          ].map((l) => ({
            ...l,
            displayNumber: `${l.lang.toUpperCase()}024`,
            displayCode: `BLGG-${l.lang.toUpperCase()}024`,
          })),
        },
      ],
      copyright: '©Konami',
    };
    fakeApi((c) => (c.path.startsWith(`/catalog/cards/${CARD}`) ? json(ygo) : undefined));
    const { container } = renderApp(<CardPage />);
    // The header and the prints table (phone layout: the number folds into the set cell).
    expect(await screen.findByText('BLGG-DE024')).toBeTruthy();
    expect(screen.getByText(/^BLGG DE024 · DE · EN/)).toBeTruthy();
    const stage = container.querySelector('[style*="aspect-ratio"]') as HTMLElement;
    expect(stage.style.aspectRatio).toBe(`${59 / 86} / 1`);
    // VB-93: the German name as the title, Yugipedia credited with source and licence linked.
    expect(screen.getByRole('heading', { name: 'Geistertrick-Engel' })).toBeTruthy();
    expect(
      screen.getByText(/^Yu-Gi-Oh!-Kartennamen und -texte in weiteren Sprachen:/),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'CC BY-SA 4.0' }).getAttribute('href')).toBe(
      'https://creativecommons.org/licenses/by-sa/4.0/',
    );
  });

  it('says under the image when it is in another language or of another print', async () => {
    const withImage = (imageLang: string, imageFrom: 'print' | 'sibling') => ({
      ...card,
      prints: card.prints.map((p) => ({
        ...p,
        localizations: p.localizations.map((l) => ({
          ...l,
          imageUrl: p.imageUrl,
          imageLang,
          imageFrom,
        })),
      })),
    });
    vi.mocked(useLocalSearchParams).mockReturnValue({ id: CARD, print: card.prints[1]?.id ?? '' });
    let body = withImage('en', 'print');
    fakeApi((c) => (c.path.startsWith(`/catalog/cards/${CARD}`) ? json(body) : undefined));
    const { unmount } = renderApp(<CardPage />);
    expect(await screen.findByText('Bild: EN')).toBeTruthy();
    unmount();

    body = withImage('ja', 'sibling');
    renderApp(<CardPage />);
    expect(await screen.findByText('Bild: JA · Bild eines anderen Drucks')).toBeTruthy();
  });

  it('says nothing under an image in the user language, or from an older server', async () => {
    const german = {
      ...card,
      prints: card.prints.map((p) => ({
        ...p,
        localizations: p.localizations.map((l) => ({
          ...l,
          imageUrl: p.imageUrl,
          imageLang: l.lang,
        })),
      })),
    };
    vi.mocked(useLocalSearchParams).mockReturnValue({ id: CARD, print: card.prints[1]?.id ?? '' });
    fakeApi((c) => (c.path.startsWith(`/catalog/cards/${CARD}`) ? json(german) : undefined));
    const { unmount } = renderApp(<CardPage />);
    await screen.findByText('Wachsamkeit');
    expect(screen.queryByText(/^Bild/)).toBeNull();
    unmount();

    fakeApi((c) => (c.path.startsWith(`/catalog/cards/${CARD}`) ? json(card) : undefined));
    renderApp(<CardPage />);
    await screen.findByText('Wachsamkeit');
    expect(screen.queryByText(/^Bild/)).toBeNull();
  });

  it('says not found for an unknown card', async () => {
    fakeApi();
    renderApp(<CardPage />);
    expect(await screen.findByText('Das gibt es hier nicht.')).toBeTruthy();
  });
});
