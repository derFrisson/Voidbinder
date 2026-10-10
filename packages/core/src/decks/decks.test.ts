import type { DeckZone, EntryPrice } from '@voidbinder/shared/api';
import { describe, expect, it } from 'vitest';
import type { DeckCard } from './common.js';
import {
  analyzeDeck,
  cheapestPrice,
  deckGroup,
  deckLimit,
  deckStat,
  missingCards,
} from './index.js';

let n = 0;
/** A deck line: a fresh card id, main zone, one copy, unless overridden. */
function card(name: string, extra: Partial<DeckCard> = {}): DeckCard {
  n += 1;
  return {
    cardId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    name,
    typeLine: null,
    text: null,
    attributes: {},
    legalities: {},
    zone: 'main' as DeckZone,
    quantity: 1,
    ...extra,
  };
}

let batch = 0;
/** `count` copies of distinct cards (names unique per call) built by `make(i)`, `per` each. */
function many(count: number, per: number, make: (i: number) => Partial<DeckCard>) {
  batch += 1;
  return Array.from({ length: Math.ceil(count / per) }, (_, i) =>
    card(`Filler ${batch}.${i}`, { quantity: Math.min(per, count - i * per), ...make(i) }),
  );
}

const codes = (r: { problems: { code: string }[] }) => r.problems.map((p) => p.code);

// ---- Magic ----

const legalIn = (...formats: string[]) =>
  Object.fromEntries(formats.map((f) => [f, 'legal'])) as Record<string, string>;
const mtg = (extra: Partial<DeckCard> = {}) => ({
  typeLine: 'Instant',
  legalities: legalIn('standard', 'modern', 'vintage', 'commander', 'pauper'),
  attributes: { cmc: 2, color_identity: ['R'] },
  ...extra,
});
/** A legal 60-card Modern deck: 15 × 4 instants. */
const modern60 = () => many(60, 4, () => mtg());

describe('Magic', () => {
  it('accepts a legal 60-card deck', () => {
    expect(analyzeDeck('mtg', 'modern', modern60())).toMatchObject({ valid: true, problems: [] });
  });

  it('needs 60 cards in the main deck', () => {
    const r = analyzeDeck(
      'mtg',
      'modern',
      many(56, 4, () => mtg()),
    );
    expect(r.problems).toEqual([{ code: 'too_few', params: { zone: 'main', count: 56, min: 60 } }]);
  });

  it('allows up to 15 sideboard cards', () => {
    const side = many(16, 4, () => mtg({ zone: 'side' }));
    expect(codes(analyzeDeck('mtg', 'modern', [...modern60(), ...side]))).toEqual(['too_many']);
  });

  it('allows four copies of a name, counted across main and side', () => {
    const bolt = mtg({ name: 'Lightning Bolt' });
    const r = analyzeDeck('mtg', 'modern', [
      ...modern60(),
      card('Lightning Bolt', { ...bolt, quantity: 3 }),
      card('Lightning Bolt', { ...bolt, quantity: 2, zone: 'side' }),
    ]);
    expect(r.problems).toEqual([
      {
        code: 'too_many_copies',
        cardId: expect.any(String),
        params: { name: 'Lightning Bolt', count: 5, limit: 4 },
      },
    ]);
  });

  it('lets basic lands (snow ones too) and "any number" cards exceed four', () => {
    const r = analyzeDeck('mtg', 'modern', [
      ...many(40, 4, () => mtg()),
      card('Mountain', mtg({ typeLine: 'Basic Land — Mountain', quantity: 10 })),
      card('Snow-Covered Mountain', mtg({ typeLine: 'Basic Snow Land — Mountain', quantity: 5 })),
      card('Relentless Rats', {
        ...mtg({ typeLine: 'Creature — Rat', quantity: 5 }),
        text: 'A deck can have any number of cards named Relentless Rats.',
      }),
    ]);
    expect(r.problems).toEqual([]);
  });

  it('takes the copies a card allows itself ("up to seven cards named …")', () => {
    const dwarves = mtg({
      typeLine: 'Creature — Dwarf',
      text: 'A deck can have up to seven cards named Seven Dwarves.',
    });
    const deck = (quantity: number) => [
      ...many(53, 4, () => mtg()),
      card('Seven Dwarves', { ...dwarves, quantity }),
    ];
    expect(analyzeDeck('mtg', 'modern', deck(7)).problems).toEqual([]);
    expect(analyzeDeck('mtg', 'modern', deck(8)).problems).toMatchObject([
      { code: 'too_many_copies', params: { name: 'Seven Dwarves', count: 8, limit: 7 } },
    ]);
    expect(deckLimit('mtg', card('Seven Dwarves', dwarves), 'modern')).toBe(7);
    expect(deckLimit('mtg', card('Bolt', mtg()), 'modern')).toBe(4);
  });

  it('reports banned and not legal cards per format', () => {
    const r = analyzeDeck('mtg', 'modern', [
      ...modern60(),
      card('Black Lotus', mtg({ zone: 'side', legalities: { modern: 'banned' } })),
      card(
        'Brand New',
        mtg({ zone: 'side', legalities: { standard: 'legal', modern: 'not_legal' } }),
      ),
      card('Unknown', mtg({ zone: 'side', legalities: {} })),
    ]);
    expect(codes(r)).toEqual(['banned', 'not_legal', 'not_legal']);
  });

  it('allows one copy of a restricted card (Vintage)', () => {
    const r = analyzeDeck('mtg', 'vintage', [
      ...many(58, 4, () => mtg()),
      card('Ancestral Recall', mtg({ quantity: 2, legalities: { vintage: 'restricted' } })),
    ]);
    expect(r.problems).toMatchObject([{ code: 'too_many_copies', params: { limit: 1 } }]);
  });

  it('reads Pauper legality like any other format', () => {
    const r = analyzeDeck('mtg', 'pauper', [
      ...modern60(),
      card(
        'Rare Thing',
        mtg({ zone: 'side', legalities: { modern: 'legal', pauper: 'not_legal' } }),
      ),
    ]);
    expect(codes(r)).toEqual(['not_legal']);
  });

  it('refuses a commander outside the commander format', () => {
    const r = analyzeDeck('mtg', 'modern', [
      ...modern60(),
      card('Krenko', mtg({ zone: 'commander', typeLine: 'Legendary Creature — Goblin' })),
    ]);
    expect(codes(r)).toEqual(['wrong_zone']);
  });

  const krenko = () =>
    card(
      'Krenko, Mob Boss',
      mtg({ zone: 'commander', typeLine: 'Legendary Creature — Goblin Warrior' }),
    );
  /** 99 singletons in red. */
  const singletons = (count = 99) => many(count, 1, () => mtg());

  it('accepts a commander deck: one commander and 99 singletons', () => {
    expect(analyzeDeck('mtg', 'commander', [krenko(), ...singletons()]).problems).toEqual([]);
  });

  it('needs 100 cards in commander (99 besides the commander)', () => {
    expect(codes(analyzeDeck('mtg', 'commander', [krenko(), ...singletons(98)]))).toEqual([
      'wrong_size',
    ]);
  });

  it('is singleton in commander', () => {
    const r = analyzeDeck('mtg', 'commander', [
      krenko(),
      ...singletons(97),
      card('Goblin Guide', mtg({ quantity: 2 })),
    ]);
    expect(r.problems).toMatchObject([{ code: 'too_many_copies', params: { limit: 1 } }]);
  });

  it('needs a commander, and a legendary creature (or a card that says it can be one)', () => {
    expect(codes(analyzeDeck('mtg', 'commander', singletons()))).toEqual(['commander_missing']);
    const shock = card('Shock', mtg({ zone: 'commander' }));
    expect(codes(analyzeDeck('mtg', 'commander', [shock, ...singletons()]))).toEqual([
      'commander_invalid',
    ]);
    const planeswalker = card('Teferi', {
      ...mtg({ zone: 'commander', typeLine: 'Legendary Planeswalker — Teferi' }),
      text: 'Teferi can be your commander.',
    });
    expect(analyzeDeck('mtg', 'commander', [planeswalker, ...singletons()]).problems).toEqual([]);
  });

  it('checks the colour identity against the commander when the data has it', () => {
    const blue = card('Counterspell', mtg({ attributes: { cmc: 2, color_identity: ['U'] } }));
    const r = analyzeDeck('mtg', 'commander', [krenko(), ...singletons(98), blue]);
    expect(r.problems).toEqual([
      { code: 'colour_identity', cardId: blue.cardId, params: { name: 'Counterspell' } },
    ]);
    // Without an identity on the commander there is nothing to check against.
    const bare = card('Krenko', { ...krenko(), attributes: {} });
    expect(analyzeDeck('mtg', 'commander', [bare, ...singletons(98), blue]).problems).toEqual([]);
  });

  it('groups by the front face type and curves the non-land mana values', () => {
    expect(deckGroup('mtg', card('x', { typeLine: 'Artifact Creature — Golem' }))).toBe('creature');
    expect(deckGroup('mtg', card('x', { typeLine: 'Sorcery // Land' }))).toBe('sorcery');
    expect(deckGroup('mtg', card('x', { typeLine: 'Basic Land — Island' }))).toBe('land');
    const r = analyzeDeck('mtg', 'modern', [
      card('a', mtg({ attributes: { cmc: 1 }, quantity: 4 })),
      card('b', mtg({ attributes: { cmc: 9 }, quantity: 1 })),
      card('c', mtg({ typeLine: 'Land', attributes: { cmc: 0 }, quantity: 20 })),
      card('d', mtg({ attributes: { cmc: 3 }, zone: 'side', quantity: 2 })),
    ]);
    expect(r.curve.kind).toBe('mana');
    expect(r.curve.buckets.map((b) => b.count)).toEqual([0, 4, 0, 0, 0, 0, 0, 1]);
    expect(deckStat('mtg', card('x', mtg({ attributes: { cmc: 3 } })))).toEqual({
      kind: 'mana',
      value: 3,
    });
  });

  it('names an unknown format', () => {
    expect(analyzeDeck('mtg', 'brawl', modern60()).problems).toEqual([
      { code: 'unknown_format', params: { format: 'brawl' } },
    ]);
  });
});

// ---- Pokémon ----

const legalPk = { standard: 'legal', expanded: 'legal' };
const basic = (extra: Partial<DeckCard> = {}) => ({
  attributes: { category: 'Pokemon', stage: 'Basic', hp: 70, attacks: [{ cost: ['Lightning'] }] },
  legalities: legalPk,
  ...extra,
});
const trainer = () => ({ attributes: { category: 'Trainer' }, legalities: legalPk });
const energy = (quantity: number) =>
  card('Basic Lightning Energy', {
    attributes: { category: 'Energy', energyType: 'Normal' },
    legalities: { standard: 'not_legal' },
    quantity,
  });
/** A legal 60-card deck: 4 basics, 36 trainers (4 each), 20 basic energy. */
const pk60 = () => [card('Pikachu', basic({ quantity: 4 })), ...many(36, 4, trainer), energy(20)];

describe('Pokémon', () => {
  it('accepts a legal 60-card deck, basic energy beyond four and in any format', () => {
    expect(analyzeDeck('pokemon', 'standard', pk60())).toMatchObject({ valid: true });
  });

  it('needs exactly 60 cards', () => {
    expect(analyzeDeck('pokemon', 'standard', [...pk60(), energy(1)]).problems).toEqual([
      { code: 'wrong_size', params: { zone: 'main', count: 61, size: 60 } },
    ]);
  });

  it('allows four copies of a name, across different cards of that name', () => {
    const r = analyzeDeck('pokemon', 'standard', [
      ...pk60().slice(1, -1),
      card('Pikachu', basic({ quantity: 3 })),
      card('Pikachu', basic({ quantity: 2 })),
      energy(19),
    ]);
    expect(r.problems).toMatchObject([
      { code: 'too_many_copies', params: { name: 'Pikachu', count: 5, limit: 4 } },
    ]);
  });

  it('needs at least one Basic Pokémon', () => {
    const r = analyzeDeck('pokemon', 'standard', [...many(40, 4, trainer), energy(20)]);
    expect(codes(r)).toEqual(['no_basic_pokemon']);
  });

  it('reads the format legality TCGdex gives', () => {
    const old = card(
      'Old Pikachu',
      basic({ legalities: { standard: 'not_legal', expanded: 'legal' } }),
    );
    const deck = [...pk60().slice(0, -1), energy(19), old];
    expect(codes(analyzeDeck('pokemon', 'standard', deck))).toEqual(['not_legal']);
    expect(analyzeDeck('pokemon', 'expanded', deck).problems).toEqual([]);
  });

  it('falls back to the regulation mark in Standard without a flag', () => {
    const marked = (mark: string) =>
      card(`Mark ${mark}`, {
        attributes: { category: 'Trainer', regulationMark: mark },
        legalities: {},
      });
    const deck = [...pk60().slice(0, -1), energy(18), marked('H'), marked('D')];
    expect(analyzeDeck('pokemon', 'standard', deck).problems).toMatchObject([
      { code: 'not_legal', params: { name: 'Mark D' } },
    ]);
    expect(analyzeDeck('pokemon', 'expanded', deck).problems).toEqual([]);
  });

  it('allows one ACE SPEC card per deck', () => {
    const ace = (name: string) =>
      card(name, { ...trainer(), attributes: { category: 'Trainer', rarity: 'ACE SPEC Rare' } });
    const base = [...pk60().slice(0, -1), energy(18)];
    expect(
      analyzeDeck('pokemon', 'standard', [...base, energy(1), ace('Prime Catcher')]).problems,
    ).toEqual([]);
    expect(
      analyzeDeck('pokemon', 'standard', [...base, ace('Prime Catcher'), ace('Master Ball')])
        .problems,
    ).toEqual([{ code: 'too_many_ace_spec', params: { count: 2 } }]);
  });

  it('allows one Radiant Pokémon per deck', () => {
    const base = [...pk60().slice(0, -1), energy(18)];
    expect(
      analyzeDeck('pokemon', 'standard', [
        ...base,
        card('Radiant Charizard', basic()),
        card('Radiant Greninja', basic()),
      ]).problems,
    ).toEqual([{ code: 'too_many_radiant', params: { count: 2 } }]);
  });

  it('allows one copy of a Prism Star card', () => {
    const base = [...pk60().slice(0, -1), energy(18)];
    expect(
      analyzeDeck('pokemon', 'expanded', [...base, card('Lunala ◇', basic({ quantity: 2 }))])
        .problems,
    ).toMatchObject([{ code: 'too_many_copies', params: { name: 'Lunala ◇', limit: 1 } }]);
    const byRarity = card('Super Boost Energy', {
      ...trainer(),
      attributes: { category: 'Energy', rarity: 'Rare Prism Star' },
    });
    expect(deckLimit('pokemon', byRarity, 'expanded')).toBe(1);
  });

  it('has no other zone than the deck', () => {
    const r = analyzeDeck('pokemon', 'standard', [
      ...pk60(),
      card('Side', { ...trainer(), zone: 'side' }),
    ]);
    expect(codes(r)).toEqual(['wrong_zone']);
  });

  it('curves the cheapest attack of each Pokémon', () => {
    const r = analyzeDeck('pokemon', 'standard', [
      card(
        'a',
        basic({
          attributes: { category: 'Pokemon', attacks: [{ cost: ['A', 'B'] }, { cost: ['A'] }] },
          quantity: 2,
        }),
      ),
      card(
        'b',
        basic({
          attributes: { category: 'Pokemon', attacks: [{ cost: ['A', 'B', 'C', 'D', 'E'] }] },
        }),
      ),
      card('c', trainer()),
    ]);
    expect(r.curve).toEqual({
      kind: 'energy',
      buckets: [
        { label: '0', count: 0 },
        { label: '1', count: 2 },
        { label: '2', count: 0 },
        { label: '3', count: 0 },
        { label: '4+', count: 1 },
      ],
    });
    expect(deckGroup('pokemon', card('t', trainer()))).toBe('trainer');
  });
});

// ---- Yu-Gi-Oh! ----

const ygo = (extra: Partial<DeckCard> = {}) => ({
  typeLine: 'Effect Monster',
  attributes: { level: 4 },
  legalities: { tcg: 'Unlimited' },
  ...extra,
});
const main40 = () => many(40, 3, () => ygo());

describe('Yu-Gi-Oh!', () => {
  it('accepts 40 to 60 main deck cards, three of each', () => {
    expect(analyzeDeck('yugioh', 'advanced', main40()).problems).toEqual([]);
    expect(
      analyzeDeck(
        'yugioh',
        'advanced',
        many(60, 3, () => ygo()),
      ).problems,
    ).toEqual([]);
  });

  it('needs 40 cards and allows 60 in the main deck', () => {
    expect(
      codes(
        analyzeDeck(
          'yugioh',
          'advanced',
          many(39, 3, () => ygo()),
        ),
      ),
    ).toEqual(['too_few']);
    expect(
      codes(
        analyzeDeck(
          'yugioh',
          'advanced',
          many(61, 3, () => ygo()),
        ),
      ),
    ).toEqual(['too_many']);
  });

  it('allows up to 15 in the extra and the side deck', () => {
    const extra = many(16, 1, () => ygo({ typeLine: 'Synchro Monster', zone: 'extra' }));
    const side = many(16, 1, () => ygo({ zone: 'side' }));
    expect(analyzeDeck('yugioh', 'advanced', [...main40(), ...extra, ...side]).problems).toEqual([
      { code: 'too_many', params: { zone: 'extra', count: 16, max: 15 } },
      { code: 'too_many', params: { zone: 'side', count: 16, max: 15 } },
    ]);
  });

  it('allows three copies across main, extra and side', () => {
    const r = analyzeDeck('yugioh', 'advanced', [
      ...main40(),
      card('Ash Blossom', ygo({ quantity: 2 })),
      card('Ash Blossom', ygo({ quantity: 2, zone: 'side' })),
    ]);
    expect(r.problems).toMatchObject([
      { code: 'too_many_copies', params: { name: 'Ash Blossom', count: 4, limit: 3 } },
    ]);
  });

  it('follows the TCG list: forbidden 0, limited 1, semi-limited 2', () => {
    const r = analyzeDeck('yugioh', 'advanced', [
      ...main40(),
      card('Pot of Greed', ygo({ legalities: { tcg: 'Banned' } })),
      card('Called by the Grave', ygo({ quantity: 2, legalities: { tcg: 'Limited' } })),
      card('Maxx "C"', ygo({ quantity: 3, legalities: { tcg: 'Semi-Limited' } })),
      card('Ok', ygo({ quantity: 2, legalities: { tcg: 'Semi-Limited' } })),
    ]);
    expect(r.problems).toMatchObject([
      { code: 'banned', params: { name: 'Pot of Greed' } },
      { code: 'too_many_copies', params: { name: 'Called by the Grave', limit: 1 } },
      { code: 'too_many_copies', params: { name: 'Maxx "C"', limit: 2 } },
    ]);
  });

  it('gives the ban list limit per card for the stepper', () => {
    const at = (tcg: string) =>
      deckLimit('yugioh', card('x', ygo({ legalities: { tcg } })), 'advanced');
    expect([at('Unlimited'), at('Semi-Limited'), at('Limited'), at('Forbidden')]).toEqual([
      3, 2, 1, 0,
    ]);
  });

  it('treats a card without a TCG status as not legal (OCG only)', () => {
    const r = analyzeDeck('yugioh', 'advanced', [
      ...main40(),
      card('OCG Only', ygo({ zone: 'side', legalities: { ocg: 'Unlimited' } })),
    ]);
    expect(codes(r)).toEqual(['not_legal']);
  });

  it('keeps Extra Deck monsters out of the main deck and others out of the extra deck', () => {
    const r = analyzeDeck('yugioh', 'advanced', [
      ...main40(),
      card('Fusion', ygo({ typeLine: 'Fusion Monster' })),
      card('Effect', ygo({ zone: 'extra' })),
      card('Link in side', ygo({ typeLine: 'Link Monster', zone: 'side' })),
    ]);
    expect(r.problems).toMatchObject([
      { code: 'wrong_zone', params: { name: 'Fusion', zone: 'main' } },
      { code: 'wrong_zone', params: { name: 'Effect', zone: 'extra' } },
    ]);
  });

  it('groups monsters, spells and traps and curves the main deck levels', () => {
    expect(deckGroup('yugioh', card('x', { typeLine: 'Spell Card' }))).toBe('spell');
    expect(deckGroup('yugioh', card('x', { typeLine: 'Trap Card' }))).toBe('trap');
    expect(deckStat('yugioh', card('x', { attributes: { rank: 4 } }))).toEqual({
      kind: 'rank',
      value: 4,
    });
    expect(deckStat('yugioh', card('x', { attributes: { linkval: 2 } }))).toEqual({
      kind: 'link',
      value: 2,
    });
    const r = analyzeDeck('yugioh', 'advanced', [
      card('a', ygo({ attributes: { level: 4 }, quantity: 3 })),
      card('b', ygo({ attributes: { level: 10 } })),
      card('c', ygo({ attributes: { level: 8 }, zone: 'extra', typeLine: 'Synchro Monster' })),
    ]);
    expect(r.curve.buckets.map((b) => b.count)).toEqual([0, 0, 0, 3, 0, 0, 0, 1]);
  });
});

// ---- Missing cards and prices ----

const at = '2026-10-09T03:00:00.000Z';
const eur = (cents: number): EntryPrice => ({
  source: 'cardmarket',
  finish: 'normal',
  lang: 'en',
  currency: 'EUR',
  marketCents: cents,
  factor: 1,
  unitCents: cents,
  observedAt: at,
});

describe('cheapestPrice', () => {
  const prices = (source: 'cardmarket' | 'tcgplayer', cents: number) => [
    {
      source,
      finish: 'normal',
      lang: 'en',
      currency: source === 'cardmarket' ? ('EUR' as const) : ('USD' as const),
      market: cents,
      observedAt: at,
    },
  ];

  it('takes the cheapest print from the source the currency prefers', () => {
    const prints = [
      { printId: 'a', finishes: ['normal'], prices: prices('cardmarket', 500) },
      { printId: 'b', finishes: ['normal'], prices: prices('cardmarket', 120) },
      { printId: 'c', finishes: ['normal'], prices: prices('tcgplayer', 50) },
      { printId: 'd', finishes: ['normal'], prices: [] },
    ];
    expect(cheapestPrice(prints, 'EUR', 'en')).toMatchObject({
      printId: 'b',
      price: { unitCents: 120 },
    });
    expect(cheapestPrice(prints, 'USD', 'en')).toMatchObject({
      printId: 'c',
      price: { currency: 'USD' },
    });
    expect(cheapestPrice(prints.slice(3), 'EUR', 'en')).toBeNull();
  });

  it('takes a print priced in the language first, then English', () => {
    const prints = [
      { printId: 'a', finishes: ['normal'], prices: prices('cardmarket', 50) },
      {
        printId: 'b',
        finishes: ['normal'],
        prices: prices('cardmarket', 300).map((p) => ({ ...p, lang: 'de' })),
      },
    ];
    expect(cheapestPrice(prints, 'EUR', 'de')).toMatchObject({
      printId: 'b',
      price: { lang: 'de' },
    });
    expect(cheapestPrice(prints, 'EUR', 'en')).toMatchObject({
      printId: 'a',
      price: { lang: 'en' },
    });
    expect(cheapestPrice(prints, 'EUR', 'fr')).toMatchObject({ printId: 'a' });
  });
});

describe('missingCards', () => {
  const line = (name: string, quantity: number, price: EntryPrice | null) => ({
    cardId: `id-${name}`,
    name,
    label: `${name} (de)`,
    quantity,
    print: { id: `p-${name}`, setCode: 'lob', number: '1', displayNumber: '1' },
    price,
  });

  it('compares copies per name (all zones) with the collection and prices the rest', () => {
    const { missing, value } = missingCards(
      [line('A', 3, eur(100)), line('A', 1, eur(100)), line('B', 2, null), line('C', 2, eur(10))],
      new Map([
        ['A', 1],
        ['C', 5],
      ]),
    );
    expect(missing).toEqual([
      {
        cardId: 'id-A',
        name: 'A (de)',
        englishName: 'A',
        printId: 'p-A',
        setCode: 'lob',
        number: '1',
        displayNumber: '1',
        needed: 4,
        owned: 1,
        unitPriceCents: 100,
        currency: 'EUR',
        source: 'cardmarket',
        observedAt: at,
      },
      expect.objectContaining({ name: 'B (de)', needed: 2, owned: 0, unitPriceCents: null }),
    ]);
    expect(value).toEqual({
      cards: 5,
      entries: 2,
      totals: [{ source: 'cardmarket', currency: 'EUR', cents: 300, observedAt: at }],
      unpriced: 2,
    });
  });
});
