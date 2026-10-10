import type { Fetch } from '../scryfall/source';

// Reading from Yugipedia (https://yugipedia.com, MediaWiki with Semantic MediaWiki, checked
// 2026-10-10): the card names and texts in the languages YGOPRODeck lacks for a card (VB-93).
// One `action=ask` query selects the card pages (`Category:Duel Monsters cards`) by their
// `Password` property, the passcode that is our `cards.oracle_key`, and prints the localized
// name, lore and Pendulum Effect of each language. The wiki refuses a query with more than about
// a dozen conditions, so one request carries ASK_BATCH passcodes. robots.txt asks for a crawl
// delay of one second; the importer waits that long before every request. The content is
// CC BY-SA 4.0 (credited in @voidbinder/shared/notices).

export const API = 'https://yugipedia.com/api.php';
export const USER_AGENT =
  'Voidbinder/0.1 (+https://voidbinder.de; hello@voidbinder.de) card localization import';

/** Passcodes per `ask` request: 11 still pass the wiki's query size limit, 15 do not. */
export const ASK_BATCH = 10;

/** Yugipedia's language prefix of the properties → `print_localizations.lang`. */
export const LANGUAGES = {
  German: 'de',
  French: 'fr',
  Italian: 'it',
  Spanish: 'es',
  Portuguese: 'pt',
} as const;

const PRINTOUTS = [
  'Password',
  'English name',
  ...Object.keys(LANGUAGES).flatMap((l) => [`${l} name`, `${l} lore`, `${l} Pendulum Effect`]),
];

/** Passcodes are eight digits on the wiki (`04731783`); ours drop the leading zeros. */
export const passcode = (key: string) => key.padStart(8, '0');

const url = (selector: string) =>
  `${API}?action=ask&format=json&query=${encodeURIComponent(
    [selector, ...PRINTOUTS.map((p) => `?${p}`), 'limit=50'].join('|'),
  )}`;

/** The `ask` URL of the card pages with these passcodes. */
export const askUrl = (keys: string[]) =>
  url(`[[Category:Duel Monsters cards]][[Password::${keys.map(passcode).join('||')}]]`);

/**
 * The `ask` URL of the pages titled with these names: the cards without a passcode (Skill Cards,
 * tokens), whose `cards.oracle_key` is a YGOPRODeck placeholder. Names with characters of the
 * query syntax are left out.
 */
export const titlesUrl = (names: string[]) => url(`[[${names.join('||')}]]`);
export const queryableTitle = (name: string) => !/[[\]{}|<>#]/.test(name);

export interface LocalizedText {
  lang: string;
  name: string;
  text: string | null;
}

export interface YugipediaPage {
  title: string;
  /** Without leading zeros, as `cards.oracle_key`. */
  passwords: string[];
  englishName: string | null;
  localizations: LocalizedText[];
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  nbsp: ' ',
};

/**
 * A property value as plain text: the wiki stores wikitext, so `<br />` becomes a line break,
 * links keep their label, italics and other tags go, entities are decoded.
 */
export function plainText(wikitext: string): string {
  return wikitext
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/'{2,}/g, '')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? m;
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return String.fromCodePoint(code);
    })
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

interface AskAnswer {
  error?: unknown;
  query?: { results?: Record<string, { printouts?: Record<string, unknown[]> }> | [] };
}

/**
 * The pages of an `ask` answer with their localizations. A Pendulum Monster's text is laid out
 * as YGOPRODeck's: the Pendulum Effect, then the monster's effect or flavor text.
 */
export function parseAnswer(body: unknown): YugipediaPage[] {
  const answer = body as AskAnswer;
  if (answer.error || !answer.query)
    throw new Error(`Yugipedia answered ${JSON.stringify(answer.error ?? body).slice(0, 300)}`);
  const results = answer.query.results;
  // An empty result set comes as `[]`.
  if (!results || Array.isArray(results)) return [];
  return Object.entries(results).map(([title, r]) => {
    const value = (p: string) => {
      const v = r.printouts?.[p]?.[0];
      return typeof v === 'string' && v.trim() ? v : null;
    };
    const localizations: LocalizedText[] = [];
    for (const [prefix, lang] of Object.entries(LANGUAGES)) {
      const name = value(`${prefix} name`);
      if (!name) continue;
      const lore = value(`${prefix} lore`);
      const pendulum = value(`${prefix} Pendulum Effect`);
      const text =
        pendulum && lore
          ? `[ Pendulum Effect ]\n${plainText(pendulum)}\n\n[ ${lore.startsWith("''") ? 'Flavor Text' : 'Monster Effect'} ]\n${plainText(lore)}`
          : lore && plainText(lore);
      localizations.push({ lang, name: plainText(name), text: text || null });
    }
    const english = value('English name');
    return {
      title,
      passwords: (r.printouts?.Password ?? [])
        .filter((p): p is string => typeof p === 'string')
        .map((p) => p.replace(/^0+(?=\d)/, '')),
      englishName: english && plainText(english),
      localizations,
    };
  });
}

/**
 * The page of each card among `pages`. By passcode: the page titled with the card's English name,
 * else the first with a German name (a passcode can sit on two pages, a card and its anime
 * version). By title: a page with the card's name as its title and no other passcode.
 */
export function pickPages(
  pages: YugipediaPage[],
  cards: { key: string; name: string }[],
  by: 'passcode' | 'title',
): Map<string, YugipediaPage> {
  const picked = new Map<string, YugipediaPage>();
  for (const card of cards) {
    const candidates = pages.filter(
      (p) =>
        p.localizations.length &&
        (by === 'passcode'
          ? p.passwords.includes(card.key)
          : p.title === card.name && (!p.passwords.length || p.passwords.includes(card.key))),
    );
    const page =
      candidates.find((p) => p.title === card.name) ??
      candidates.find((p) => p.localizations.some((l) => l.lang === 'de')) ??
      candidates[0];
    if (page) picked.set(card.key, page);
  }
  return picked;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Wait before every request: one request per second. */
export const CRAWL_DELAY_MS = 1000;

/** One `ask` request, after the crawl delay; the body as Yugipedia sent it (the raw copy). */
export async function ask(
  fetchFn: Fetch,
  askUrl: string,
  delayMs = CRAWL_DELAY_MS,
): Promise<string> {
  if (delayMs) await sleep(delayMs);
  const res = await fetchFn(askUrl, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`GET ${askUrl} answered ${res.status}`);
  return res.text();
}
