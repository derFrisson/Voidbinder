import type { Game, Locale } from './index.js';

// Rights notices per game (VB-57), from docs/marketing/card-imagery-legal.md section 7. The app
// shows the notice of every game it serves and, on a card page, the artist and the game's
// copyright line next to the image. Wizards' Fan Content Policy requires its notice verbatim, so
// the Magic notice stays in English in both locales.

/** The game's copyright line for a card page, next to the artist. */
export const COPYRIGHT: Record<Game, string> = {
  mtg: '©Wizards of the Coast LLC',
  pokemon: '© The Pokémon Company, Nintendo, Game Freak and/or Creatures',
  yugioh: '© 4K Media Inc., a subsidiary of Konami Digital Entertainment, Inc.',
  onepiece: '© Eiichiro Oda/Shueisha, Toei Animation',
};

const MTG =
  'Voidbinder is unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.';

export const NOTICES: Record<Game, Record<Locale, string>> = {
  mtg: { en: MTG, de: MTG },
  pokemon: {
    en: 'Pokémon and Pokémon character names are trademarks of Nintendo. Card images and text are © The Pokémon Company, Nintendo, Game Freak and/or Creatures. Voidbinder is not produced by, endorsed by, supported by, or affiliated with Pokémon, Nintendo, Game Freak or Creatures.',
    de: 'Pokémon und die Namen der Pokémon-Figuren sind Marken von Nintendo. Kartenbilder und -texte © The Pokémon Company, Nintendo, Game Freak und/oder Creatures. Voidbinder wird nicht von Pokémon, Nintendo, Game Freak oder Creatures produziert, befürwortet oder unterstützt und ist mit ihnen nicht verbunden.',
  },
  yugioh: {
    en: 'Yu-Gi-Oh! card images and text are © 4K Media Inc., a subsidiary of Konami Digital Entertainment, Inc. Voidbinder is not produced by, endorsed by, supported by, or affiliated with 4K Media or Konami Digital Entertainment.',
    de: 'Yu-Gi-Oh!-Kartenbilder und -texte © 4K Media Inc., eine Tochtergesellschaft von Konami Digital Entertainment, Inc. Voidbinder wird nicht von 4K Media oder Konami Digital Entertainment produziert, befürwortet oder unterstützt und ist mit ihnen nicht verbunden.',
  },
  onepiece: {
    en: 'ONE PIECE Card Game card images and text © Eiichiro Oda/Shueisha, Toei Animation; the game is published by Bandai. Voidbinder is not produced by, endorsed by, or affiliated with Bandai, Shueisha or Toei Animation.',
    de: 'Kartenbilder und -texte des ONE PIECE Card Game © Eiichiro Oda/Shueisha, Toei Animation; das Spiel wird von Bandai herausgegeben. Voidbinder wird nicht von Bandai, Shueisha oder Toei Animation produziert oder befürwortet und ist mit ihnen nicht verbunden.',
  },
};

/** Scryfall's data-source attribution, shown wherever Magic data or images appear. */
export const SCRYFALL_ATTRIBUTION: Record<Locale, string> = {
  en: 'Magic card data and images via Scryfall. Voidbinder is not endorsed by Scryfall.',
  de: 'Magic-Kartendaten und -bilder über Scryfall. Voidbinder wird nicht von Scryfall befürwortet.',
};

/**
 * Yugipedia's attribution (VB-93): the Yu-Gi-Oh! names and texts YGOPRODeck lacks come from
 * Yugipedia under CC BY-SA 4.0, so wherever they appear the source and the licence are named and
 * linked (the app's footer and the Yu-Gi-Oh! card page, the offline module's `meta`).
 */
export const YUGIPEDIA_ATTRIBUTION: Record<Locale, string> = {
  en: 'Yu-Gi-Oh! card names and texts in other languages: Yugipedia (CC BY-SA 4.0)',
  de: 'Yu-Gi-Oh!-Kartennamen und -texte in weiteren Sprachen: Yugipedia (CC BY-SA 4.0)',
};
/**
 * pokemontcg.io's attribution (VB-118): the pictures of the Pokémon prints TCGdex has none for
 * (McDonald's collections, galleries, trainer kits) come from the Pokémon TCG API.
 */
export const POKEMONTCG_ATTRIBUTION: Record<Locale, string> = {
  en: 'Card images: Pokémon TCG API (pokemontcg.io)',
  de: 'Kartenbilder: Pokémon TCG API (pokemontcg.io)',
};
export const POKEMONTCG_URL = 'https://pokemontcg.io';
export const YUGIPEDIA_URL = 'https://yugipedia.com';
export const CC_BY_SA_URL = 'https://creativecommons.org/licenses/by-sa/4.0/';
