import { describe, expect, it } from 'vitest';
import { FACE_SEPARATOR, mapCard, mapLocalization, mapPrint, mapSet, skipReason } from './map';
import { fixture } from './test-fixtures';
import type { ScryfallCard, ScryfallList, ScryfallSet } from './types';

const cards = fixture('default_cards.jsonl')
  .trimEnd()
  .split('\n')
  .map((l) => JSON.parse(l) as ScryfallCard);
const others = fixture('all_cards.jsonl')
  .trimEnd()
  .split('\n')
  .map((l) => JSON.parse(l) as ScryfallCard);
const sets = (JSON.parse(fixture('sets.json')) as ScryfallList<ScryfallSet>).data;
const card = (set: string, number: string, list = cards) => {
  const c = list.find((x) => x.set === set && x.collector_number === number);
  if (!c) throw new Error(`fixture ${set} ${number} missing`);
  return c;
};

describe('Scryfall mapping', () => {
  it('maps a normal card to card, print and English localization', () => {
    const source = card('mid', '1');
    expect(skipReason(source)).toBeNull();
    expect(mapCard(source)).toMatchObject({
      oracleKey: source.oracle_id,
      name: 'Adeline, Resplendent Cathar',
      typeLine: 'Legendary Creature — Human Knight',
      text: source.oracle_text,
      attributes: { mana_cost: '{1}{W}{W}', cmc: 3, colors: ['W'], power: '*', toughness: '4' },
      legalities: { commander: 'legal' },
    });
    const print = mapPrint(source);
    expect(print).toMatchObject({
      number: '1',
      rarity: 'rare',
      finishes: ['normal', 'foil'],
      artist: source.artist,
      releasedOn: '2021-09-24',
    });
    expect(print.externalIds).toMatchObject({
      scryfall: source.id,
      tcgplayer: source.tcgplayer_id,
      cardmarket: source.cardmarket_id,
      scryfall_images: { normal: expect.stringContaining('/normal/') },
    });
    expect(print.externalIds).not.toHaveProperty('prices');
    expect(mapLocalization(source)).toMatchObject({
      lang: 'en',
      name: source.name,
      text: source.oracle_text,
    });
  });

  it('maps a foil-only print', () => {
    expect(mapPrint(card('mid', '385')).finishes).toEqual(['foil']);
  });

  it('joins the faces of a double-faced card and keeps only their oracle fields', () => {
    const source = card('mid', '2');
    const mapped = mapCard(source);
    expect(mapped.name).toBe('Ambitious Farmhand // Seasoned Cathar');
    expect(mapped.typeLine).toBe('Creature — Human Peasant // Creature — Human Knight');
    expect(mapped.text?.split(FACE_SEPARATOR)).toHaveLength(2);
    const faces = mapped.attributes.card_faces as Record<string, unknown>[];
    expect(faces.map((f) => f.name)).toEqual(['Ambitious Farmhand', 'Seasoned Cathar']);
    expect(faces[0]).not.toHaveProperty('artist');
    expect(faces[0]).not.toHaveProperty('image_uris');
    const ids = mapPrint(source).externalIds;
    expect(ids.scryfall_images).toMatchObject({ normal: expect.stringContaining('/front/') });
    expect(ids.scryfall_back_images).toMatchObject({ normal: expect.stringContaining('/back/') });
  });

  it('skips tokens and digital-only cards', () => {
    expect(skipReason(card('tmid', '1'))).toBe('layout');
    expect(skipReason(card('ymid', '1'))).toBe('digital');
  });

  it('maps the printed name and text of another language, faces included', () => {
    expect(mapLocalization(card('mid', '1', others))).toMatchObject({
      lang: 'de',
      name: 'Adeline, strahlende Katharerin',
      text: expect.stringContaining('Katharer'),
    });
    expect(mapLocalization(card('mid', '2', others))).toMatchObject({
      lang: 'de',
      name: 'Ehrgeizige Magd // Routinierte Katharerin',
      text: expect.stringContaining(FACE_SEPARATOR),
    });
  });

  it('keeps paper sets and drops digital and token sets', () => {
    const mapped = Object.fromEntries(sets.map((s) => [s.code, mapSet(s)]));
    expect(mapped.ymid).toBeNull();
    expect(mapped.tmid).toBeNull();
    expect(mapped.mid).toMatchObject({
      name: 'Innistrad: Midnight Hunt',
      releasedOn: '2021-09-24',
      cardCount: 392,
      kind: 'expansion',
      externalIds: { icon_svg_uri: expect.stringContaining('mid.svg') },
    });
  });
});
