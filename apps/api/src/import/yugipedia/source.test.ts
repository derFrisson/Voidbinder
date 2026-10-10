import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { askUrl, parseAnswer, pickPages, plainText, queryableTitle } from './source';

// Real `action=ask` answers (Yugipedia, 2026-10-10) for the queries askUrl and titlesUrl build.
const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      new URL(`../../../test/fixtures/yugipedia/${name}`, import.meta.url).pathname,
      'utf8',
    ),
  );

describe('Yugipedia source', () => {
  it('asks for the card pages by eight-digit passcode', () => {
    const query = decodeURIComponent(askUrl(['4731783', '34950192']).split('query=')[1] ?? '');
    expect(query).toMatch(
      /^\[\[Category:Duel Monsters cards\]\]\[\[Password::04731783\|\|34950192\]\]\|\?Password\|/,
    );
    expect(query).toContain('|?German name|?German lore|?German Pendulum Effect|');
  });

  it('reads the names and texts of every language from a card page', () => {
    const pages = parseAnswer(fixture('ask_passcodes.json'));
    const lev = pages.find((p) => p.title === 'Lev Shaddoll Fusion');
    expect(lev?.passwords).toEqual(['34950192']);
    expect(lev?.localizations.map((l) => [l.lang, l.name])).toEqual([
      ['de', 'Lev-Schattenpuppen-Fusion'],
      ['fr', "Fusion Marionnette de l'Ombre Lev"],
      ['it', 'Fusione Lev Bambolaombra'],
      ['es', 'Fusión Lev Sombrañeca'],
      ['pt', 'Fusão Lev Sombraneco'],
    ]);
    expect(lev?.localizations[0]?.text).toMatch(/^Wenn diese Karte aktiviert wird: Lege 1 /);
    // The Pendulum Effect first, laid out as YGOPRODeck's texts.
    const oddEyes = pages.find((p) => p.title === 'Odd-Eyes Pendulum Dragon');
    expect(oddEyes?.localizations[0]?.text).toMatch(
      /^\[ Pendulum Effect \]\nDu kannst .*\n\n\[ Monster Effect \]\nFalls diese Karte /s,
    );
  });

  it('turns wikitext into plain text', () => {
    expect(plainText("''Der ultimative Hexer.''")).toBe('Der ultimative Hexer.');
    expect(plainText('Ein „[[Phantasm|Fantasma]]“.<br />● FINSTERNIS')).toBe(
      'Ein „Fantasma“.\n● FINSTERNIS',
    );
    expect(plainText('Maliss <&#80;> Chessykatze')).toBe('Maliss <P> Chessykatze');
  });

  it('picks a page by passcode, or by title when the card has no passcode', () => {
    const pages = parseAnswer(fixture('ask_passcodes.json'));
    const lev = { key: '34950192', name: 'Lev Shaddoll Fusion' };
    expect(pickPages(pages, [lev], 'passcode').get(lev.key)?.title).toBe('Lev Shaddoll Fusion');
    // Another card's passcode on the right title is not this card.
    expect(pickPages(pages, [{ ...lev, key: '1' }], 'title').size).toBe(0);
    const skill = { key: '300104004', name: 'Cocoon of Ultra Evolution (Skill Card)' };
    const byTitle = pickPages(parseAnswer(fixture('ask_titles.json')), [skill], 'title');
    expect(byTitle.get(skill.key)?.localizations[0]).toMatchObject({
      lang: 'de',
      name: 'Kokon der Ultra-Evolution',
    });
    expect(queryableTitle('Maliss <P> Chessy Cat')).toBe(false);
  });

  it('fails on an error answer and reads an empty result set', () => {
    expect(() => parseAnswer({ error: { query: ['too big'] } })).toThrow(/Yugipedia answered/);
    expect(parseAnswer({ query: { results: [] } })).toEqual([]);
  });
});
