import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { Game } from '@voidbinder/shared';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, json, renderApp, signedIn, type Call } from '../../../test/fake-api';
import CardPage from '../../app/cards/[id]';
import { hideToast, Toaster } from '../Toast';
import { languageOptions, session } from './AddDialog';
import { QuickAdd } from './CollectButtons';

// VB-80: the add dialog (language, finish, condition, quantity, binder) on the card page and
// behind the tiles' quick add.

const CARD = 'c0000000-0000-4000-8000-000000000001';
const PRINT = 'p0000000-0000-4000-8000-000000000001';
const BINDER = 'b0000000-0000-4000-8000-000000000001';
const at = '2026-10-10T00:00:00.000Z';

const cardOf = (game: Game, langs: string[], finishes = ['normal', 'foil']) => ({
  card: {
    id: CARD,
    game,
    name: 'Dark Magician',
    typeLine: null,
    text: null,
    attributes: {},
    legalities: {},
  },
  prints: [
    {
      id: PRINT,
      cardId: CARD,
      set: { game, code: 'lob', name: 'Legend of Blue Eyes' },
      number: '005',
      variant: '',
      rarity: 'Ultra Rare',
      finishes,
      artist: null,
      releasedOn: null,
      imageUrl: null,
      externalIds: {},
      localizations: langs.map((lang) => ({
        lang,
        name: 'Dark Magician',
        text: null,
        imageUrl: null,
      })),
    },
  ],
  copyright: '',
});

/** The fake API for one card; POST and PATCH answer with what they got. */
function api(card: ReturnType<typeof cardOf>) {
  return fakeApi(signedIn, (c: Call) => {
    if (c.path === `/catalog/cards/${CARD}`) return json(card);
    if (c.path.startsWith('/collection/owned'))
      return json({ owned: {}, byFinish: {}, wished: {} });
    if (c.path === '/collection/binders')
      return json({
        binders: [
          {
            id: BINDER,
            name: 'Yu-Gi-Oh! Klassiker',
            game: 'yugioh',
            position: 0,
            colour: null,
            createdAt: at,
            updatedAt: at,
          },
        ],
      });
    if (c.method === 'POST') return json({ entries: [] }, 201);
    if (c.method === 'PATCH') return json({});
    return undefined;
  });
}

const radios = (group: string) =>
  within(screen.getByRole('radiogroup', { name: group }))
    .getAllByRole('radio')
    .map((r) => r.textContent);
const checked = (group: string) =>
  within(screen.getByRole('radiogroup', { name: group }))
    .getAllByRole('radio')
    .find((r) => r.getAttribute('aria-checked') === 'true')?.textContent;
const pick = (group: string, option: string) =>
  fireEvent.click(
    within(screen.getByRole('radiogroup', { name: group })).getByRole('radio', { name: option }),
  );

beforeEach(() => {
  session.language = undefined;
  vi.mocked(useLocalSearchParams).mockReturnValue({ id: CARD });
});
afterEach(() => act(() => hideToast()));

describe('languageOptions', () => {
  it('offers every TCG language for Yu-Gi-Oh!, the localized ones first', () => {
    expect(languageOptions('yugioh', ['en', 'de'])).toEqual([
      'en',
      'de',
      'fr',
      'it',
      'es',
      'pt',
      'ja',
    ]);
    expect(languageOptions('yugioh', ['de'])).toEqual(['de', 'en', 'fr', 'it', 'es', 'pt', 'ja']);
  });

  it("offers the print's localizations for the other games, English when there are none", () => {
    expect(languageOptions('mtg', ['de', 'en'])).toEqual(['de', 'en']);
    expect(languageOptions('pokemon', [])).toEqual(['en']);
    expect(languageOptions(undefined, [])).toEqual(['en']);
  });
});

describe('add dialog on the card page', () => {
  it('is a labelled modal dialog with the chips of a Yu-Gi-Oh! print', async () => {
    api(cardOf('yugioh', ['en', 'de'], ['normal']));
    renderApp(<CardPage />);
    fireEvent.click(await screen.findByRole('button', { name: '+ In Sammlung' }));
    const dialog = await screen.findByRole('dialog', { name: 'In die Sammlung legen' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    await screen.findByRole('radiogroup', { name: 'Sprache' });
    expect(radios('Sprache')).toEqual(['EN', 'DE', 'FR', 'IT', 'ES', 'PT', 'JA']);
    // One finish: nothing to choose.
    expect(screen.queryByRole('radiogroup', { name: 'Ausführung' })).toBeNull();
    expect(radios('Zustand')).toEqual(['MT', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO']);
    expect(checked('Zustand')).toBe('NM');
    expect(screen.getByRole('combobox', { name: 'Mappe' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Notiz' })).toBeTruthy();
    // Focus is inside the dialog; Escape closes it.
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    fireEvent.keyUp(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it("offers a Magic print's localizations only, and its finishes", async () => {
    api(cardOf('mtg', ['en', 'de']));
    renderApp(<CardPage />);
    fireEvent.click(await screen.findByRole('button', { name: '+ In Sammlung' }));
    await screen.findByRole('radiogroup', { name: 'Sprache' });
    expect(radios('Sprache')).toEqual(['EN', 'DE']);
    expect(radios('Ausführung')).toEqual(['Normal', 'Foil']);
  });

  it('adds with every choice, then remembers the language for the next add', async () => {
    const calls = api(cardOf('yugioh', ['en', 'de']));
    renderApp(<CardPage />);
    fireEvent.click(await screen.findByRole('button', { name: '+ In Sammlung' }));
    await screen.findByRole('radiogroup', { name: 'Sprache' });
    // The UI is German and the card page has no language chip: German first.
    expect(checked('Sprache')).toBe('DE');
    pick('Sprache', 'FR');
    pick('Ausführung', 'Foil');
    pick('Zustand', 'EX');
    fireEvent.click(screen.getByRole('button', { name: 'Anzahl: eins mehr' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Mappe' }), {
      target: { value: BINDER },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Notiz' }), {
      target: { value: 'Tausch mit Jo' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Hinzufügen' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual([
      {
        id: expect.any(String),
        printId: PRINT,
        language: 'fr',
        finish: 'foil',
        condition: 'EX',
        quantity: 2,
        binderId: BINDER,
        note: 'Tausch mit Jo',
      },
    ]);
    fireEvent.click(screen.getByRole('button', { name: '+ In Sammlung' }));
    await screen.findByRole('radiogroup', { name: 'Sprache' });
    expect(checked('Sprache')).toBe('FR');
  });

  it('takes the browsing language (`?lang=`) over the UI language', async () => {
    vi.mocked(useLocalSearchParams).mockReturnValue({ id: CARD, lang: 'en' });
    api(cardOf('mtg', ['en', 'de']));
    renderApp(<CardPage />);
    fireEvent.click(await screen.findByRole('button', { name: '+ In Sammlung' }));
    await screen.findByRole('radiogroup', { name: 'Sprache' });
    expect(checked('Sprache')).toBe('EN');
  });

  it('puts a wish on the list with "egal" defaults or a minimum condition', async () => {
    const calls = api(cardOf('mtg', ['en', 'de']));
    renderApp(<CardPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Auf Wunschliste' }));
    await screen.findByRole('dialog', { name: 'Auf die Wunschliste setzen' });
    await screen.findByRole('radiogroup', { name: 'Sprache' });
    expect(radios('Sprache')).toEqual(['Egal', 'EN', 'DE']);
    expect(radios('Ausführung')).toEqual(['Egal', 'Normal', 'Foil']);
    expect(checked('Mindestzustand')).toBe('Egal');
    expect(screen.queryByRole('combobox', { name: 'Mappe' })).toBeNull();
    pick('Mindestzustand', 'NM');
    fireEvent.click(screen.getByRole('button', { name: 'Vormerken' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls.find((c) => c.path === '/collection/wishlist')?.body).toEqual([
      {
        id: expect.any(String),
        printId: PRINT,
        quantity: 1,
        language: null,
        finish: null,
        minCondition: 'NM',
      },
    ]);
  });

  it('keeps the dialog open and says so when adding fails', async () => {
    fakeApi(signedIn, (c) => {
      if (c.path === `/catalog/cards/${CARD}`) return json(cardOf('mtg', ['en']));
      if (c.method === 'POST')
        return json({ error: { code: 'internal', message: 'x', requestId: 'r' } }, 500);
      return undefined;
    });
    renderApp(<CardPage />);
    fireEvent.click(await screen.findByRole('button', { name: '+ In Sammlung' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Hinzufügen' }));
    expect(await screen.findByText('Hinzufügen hat nicht geklappt.')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});

describe('quick add from a tile', () => {
  it('adds with the defaults, says how in a toast, and "Ändern" edits that entry', async () => {
    vi.mocked(useLocalSearchParams).mockReturnValue({});
    const calls = api(cardOf('yugioh', ['en', 'de']));
    renderApp(
      <>
        <QuickAdd printId={PRINT} cardId={CARD} name="Dark Magician" finish="normal" />
        <Toaster />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'In Sammlung: Dark Magician' }));
    expect(await screen.findByText('Als DE · Normal · NM hinzugefügt')).toBeTruthy();
    const post = calls.find((c) => c.method === 'POST')?.body as { id: string }[];
    expect(post).toEqual([
      expect.objectContaining({ printId: PRINT, language: 'de', finish: 'normal', quantity: 1 }),
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Ändern' }));
    await screen.findByRole('dialog', { name: 'Hinzugefügte Karte ändern' });
    await screen.findByRole('radiogroup', { name: 'Sprache' });
    expect(checked('Sprache')).toBe('DE');
    pick('Sprache', 'JA');
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch?.path).toBe(`/collection/entries/${post[0]?.id}`);
    expect(patch?.body).toEqual(
      expect.objectContaining({ language: 'ja', finish: 'normal', condition: 'NM', quantity: 1 }),
    );
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    // The toast's button is gone: focus goes back to the tile's button, not to the page.
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'In Sammlung: Dark Magician' }),
      ),
    );
  });

  it('takes its toast down with it when the tile goes', async () => {
    vi.mocked(useLocalSearchParams).mockReturnValue({});
    api(cardOf('yugioh', ['en', 'de']));
    function Host() {
      const [shown, setShown] = useState(true);
      return (
        <>
          {shown && <QuickAdd printId={PRINT} cardId={CARD} name="Dark Magician" finish="normal" />}
          <Pressable role="button" aria-label="weg" onPress={() => setShown(false)} />
          <Toaster />
        </>
      );
    }
    renderApp(<Host />);
    fireEvent.click(screen.getByRole('button', { name: 'In Sammlung: Dark Magician' }));
    await screen.findByText('Als DE · Normal · NM hinzugefügt');
    fireEvent.click(screen.getByRole('button', { name: 'weg' }));
    await waitFor(() => expect(screen.queryByText('Als DE · Normal · NM hinzugefügt')).toBeNull());
    expect(screen.queryByRole('button', { name: 'Ändern' })).toBeNull();
  });

  it('opens the dialog on a long press instead of adding', async () => {
    const calls = api(cardOf('mtg', ['en', 'de']));
    renderApp(<QuickAdd printId={PRINT} cardId={CARD} name="Dark Magician" finish="normal" />);
    const button = screen.getByRole('button', { name: 'In Sammlung: Dark Magician' });
    vi.useFakeTimers();
    try {
      fireEvent.mouseDown(button, { button: 0 });
      act(() => vi.advanceTimersByTime(800));
      fireEvent.mouseUp(button, { button: 0 });
    } finally {
      vi.useRealTimers();
    }
    expect(await screen.findByRole('dialog', { name: 'In die Sammlung legen' })).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });
});
