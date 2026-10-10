import { eq, sql } from 'drizzle-orm';
import {
  YUGIOH_FOIL_TIERS,
  YUGIOH_RARITIES,
  YUGIOH_RARITY_ARTWORK,
  yugiohRarityAbbr,
  yugiohScanBacks,
} from '@voidbinder/shared';
import { appMeta, importRuns, sets } from '../../db/schema';
import { log } from '../../middleware/log';
import { extension, sourceId } from '../images';
import type { ImportDeps, StepRunner } from '../scryfall/pipeline';
import { chunkKey, deletePrefix, readChunk, type Fetch } from '../scryfall/source';
import { failRun, finishRun, type Db } from '../scryfall/write';
import { parseSetCode } from '../ygoprodeck/map';
import { batches } from '../util';
import { ARTWORK, COOL_DOWN_DAYS, GALLERY_RARITY, markChecked } from './pipeline';
import { API, ask, plainText } from './source';

// The artwork each Yu-Gi-Oh! print was printed with (VB-106), from Yugipedia's set card galleries.
// YGOPRODeck keeps one image per passcode (the first of `card_images`), so every print of a card
// with several artworks, and every Extended Art or alternate-art reprint, shows the default one.
// Yugipedia's `Set Card Galleries:<set> (TCG-<region>-<edition>)` pages list every print with
// its scan, and the `Set gallery` template (Module:Card collection/modules/Set gallery/handlers,
// read 2026-10-10) builds each file name from the row:
//
//   RA05-EN141; Red-Eyes Dark Dragoon;; EA        (number; name; rarity; alt // options)
//   → RedEyesDarkDragoon-RA05-EN-UR-1E-EA.png     (image name-set-region-rarity-edition-alt.ext)
//
// The rarity is the gallery's `rarity=` unless the row has one; `alt` is a free file name suffix
// (EA extended art, AA/AA2/Alt alternate artwork, B/C/ReprintB further scans of one number, L/S/K
// deck letters); `// file::` replaces the name, `// extension::jpg` the extension. Only the prints
// this matters for are resolved: the prints of a card YGOPRODeck has several artworks of
// (`external_ids.artworks`, written by the YGOPRODeck import) and the prints whose gallery row has
// an alt code. Each gets `external_ids.artwork = { file, url, alt? }` (the English one on the
// print, the others on their localization); the image mirror copies the scan into R2 and then
// replaces the old key (src/import/images.ts reads `artwork.url` before YGOPRODeck's `image_url`)
// only for a scan of an artwork other than the standard one (VB-117): a row with an alt code, or a
// rarity printed with an artwork of its own (Grand Master Rare, `own_art`). Every other print shows
// the passcode render; its scan is recorded but not shown.
// The alt codes are each gallery's own (the German RA04 page has no `AA` where the English one
// has), so a code is a file name part, never a fact about the artwork across languages. A shown
// row whose scan is missing (RA05's Starlight Rares) falls back to the same artwork in another
// rarity of the set of the same or a plainer foil tier (`yugiohScanBacks`, `sibling: true`); a print
// without a matching row or scan keeps the passcode image. A print YGOPRODeck lists with a
// placeholder rarity (`New`, VB-117) takes the one row of its number no other print of it has
// (`resolveRarities`). One request per second; a set is looked at again after COOL_DOWN_DAYS, or
// the next day while it has a print without a rarity.

/** The namespace `Set Card Galleries`. */
export const GALLERY_NAMESPACE = 3024;
/** Titles per `revisions` / `imageinfo` request (MediaWiki's limit for non-bots). */
export const TITLES_PER_REQUEST = 50;
/** Sets per Workflow step: a few requests for the pages, a few dozen for the files. */
export const SETS_PER_STEP = 20;
/** `app_meta` key of the map set code → UTC day its galleries were last read. */
export const GALLERIES_CHECKED_KEY = 'yugipedia_galleries_checked';

/** Gallery region → `print_localizations.lang` (`en` is the print itself). */
const REGION_LANG: Record<string, string> = {
  EN: 'en',
  NA: 'en',
  EU: 'en',
  AU: 'en',
  OC: 'en',
  DE: 'de',
  FR: 'fr',
  FC: 'fr',
  IT: 'it',
  SP: 'es',
  PT: 'pt',
};
const REGION_ORDER = ['EN', 'NA', 'EU', 'AU', 'OC', 'FR', 'FC'];
const EDITION_ORDER = ['1E', 'UE', 'LE'];
export const GALLERY_LANGS = ['en', 'de', 'fr', 'it', 'es', 'pt'];

/** A rarity name or abbreviation → the abbreviation of the file names, null when unknown. */
export const rarityAbbr = yugiohRarityAbbr;

/** Module:Card image name: the card name in a file name (`Dark Magician (Arkana)` → `DarkMagician`). */
export function imageName(name: string): string {
  return plainText(name)
    .replace(/#/g, '')
    .replace(/\s*\(.*$/s, '')
    .replace(/[ #,.:'"?!&@%=[\]<>/☆★・-]/gu, '');
}

export interface GalleryPage {
  title: string;
  /** The set's name as the wiki writes it. */
  set: string;
  /** `EN`, `NA`, `DE`, … */
  region: string;
  /** `1E`, `UE`, `LE`; null for a page without one (`(TCG-DE)`). */
  edition: string | null;
  lang: string;
}

/**
 * A TCG gallery title (or set list title, `Set Card Lists:<set> (TCG-DE)`, VB-94) in a language we
 * store, else null (OCG, Korean, Asian English, …).
 */
export function parseGalleryTitle(title: string): GalleryPage | null {
  const m = /^Set Card (?:Galleries|Lists):(.+) \(TCG-([A-Z]+)(?:-([A-Z0-9]+))?\)$/.exec(title);
  const [, set = '', region = '', edition] = m ?? [];
  const lang = REGION_LANG[region];
  if (!lang) return null;
  return { title, set, region, edition: edition ?? null, lang };
}

/** Pages of one language best first: `EN` before `NA` before `EU`, 1st Edition before Unlimited. */
export const pageRank = (p: GalleryPage) => {
  const r = REGION_ORDER.indexOf(p.region);
  const e = EDITION_ORDER.indexOf(p.edition ?? '');
  return (r < 0 ? 0 : r) * 10 + (e < 0 ? EDITION_ORDER.length : e);
};

/** A set name for matching ours (YGOPRODeck's) to the wiki's: `Legendary 5D&apos;s Decks`, `Premium Pack (TCG)`. */
export const setNameKey = (name: string) =>
  plainText(name)
    .replace(/\s*\(TCG\)$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

export interface GalleryRow {
  /** As printed: `RA05-EN141`. */
  code: string;
  rarity: string;
  /** '' or the alt code (`EA`, `AA`, `AA2`, …). */
  alt: string;
  file: string;
}

/** The top-level `|`-separated parts of a template call's body. */
function templateParts(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const two = body.slice(i, i + 2);
    if (two === '{{' || two === '[[') {
      depth++;
      i++;
    } else if ((two === '}}' || two === ']]') && depth > 0) {
      depth--;
      i++;
    } else if (body[i] === '|' && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  return parts;
}

/**
 * Every call of the template `name` (`Set gallery`, `Set list`) on a page: its named parameters
 * (keys in lower case) and the lines of its unnamed ones (the rows).
 */
export function templateCalls(
  wikitext: string,
  name: string,
): { named: Record<string, string>; lines: string[] }[] {
  const calls: { named: Record<string, string>; lines: string[] }[] = [];
  const open = new RegExp(`\\{\\{\\s*${name}\\s*\\|`, 'gi');
  for (let m = open.exec(wikitext); m; m = open.exec(wikitext)) {
    // The call's end: the `}}` that closes it.
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < wikitext.length && depth; i++) {
      if (wikitext.startsWith('{{', i)) {
        depth++;
        i++;
      } else if (wikitext.startsWith('}}', i)) {
        depth--;
        i++;
      }
    }
    const body = wikitext.slice(m.index + m[0].length, i - 2);
    open.lastIndex = i;
    const named: Record<string, string> = {};
    const lines: string[] = [];
    for (const part of templateParts(body)) {
      const [, key, value = ''] = /^\s*([\w$-]+)\s*=([\s\S]*)$/.exec(part) ?? [];
      if (key) named[key.toLowerCase()] = value.trim();
      else lines.push(...part.split('\n'));
    }
    calls.push({ named, lines });
  }
  return calls;
}

/**
 * The rows of every `{{Set gallery}}` on a gallery page with the file name the template builds.
 * Rows without a card number (`abbr=`) and with an unknown rarity are left out.
 */
export function parseGallery(wikitext: string, page: GalleryPage): GalleryRow[] {
  const rows: GalleryRow[] = [];
  for (const { named, lines } of templateCalls(wikitext, 'Set gallery')) {
    if (named.abbr) continue;
    const region = named.region?.toUpperCase() || page.region;
    const edition = named.edition?.toUpperCase() || page.edition;
    for (const line of lines) {
      if (!line.trim()) continue;
      const [values = '', options = ''] = line.split(/\/\/(.*)/s);
      const opts = Object.fromEntries(
        options.split(';').map((o) => {
          const [k = '', v = ''] = o.split('::');
          return [k.trim(), v.trim()];
        }),
      );
      if (opts.abbr) continue;
      const [code = '', name = '', rarityIn = '', altIn = ''] = values
        .split(';')
        .map((v) => v.trim());
      const rarity = rarityAbbr(rarityIn || named.rarity || 'Common');
      if (!code || !name || !rarity) continue;
      const alt = altIn || named.alt || '';
      const file =
        opts.file ||
        `${[
          imageName(name),
          code.replace(/-.*$/s, '').replace(/\//g, ''),
          region,
          rarity,
          edition,
          alt,
        ]
          .filter(Boolean)
          .join('-')}.${opts.extension || 'png'}`;
      rows.push({ code, rarity, alt, file });
    }
  }
  return rows;
}

/**
 * A print number without its region (`EN141`, `DE141`, `E001`, `ENSE1` → `141`/`001`/`SE1`), so a German or a
 * European English row finds the print YGOPRODeck keys by the English (or North American) code.
 * ponytail: a regex over the known region tokens; a number that starts with one of the letters
 * without being a region would lose it on both sides alike.
 */
export const numberKey = (number: string) =>
  number.replace(/^(EN|DE|FR|IT|SP|PT|E|G|F|I|S|P)(?=[A-Z]*\d)/, '');

/** One MediaWiki API request, after the crawl delay; `format=json` last, so a title never ends the URL in `.png` (MediaWiki answers that with a "Security redirect"). */
export function apiUrl(params: Record<string, string>): string {
  return `${API}?${new URLSearchParams({ action: 'query', ...params, format: 'json' })}`;
}

interface Answer {
  error?: unknown;
  continue?: Record<string, string>;
  query?: {
    allpages?: { title: string }[];
    normalized?: { from: string; to: string }[];
    pages?: Record<
      string,
      {
        title: string;
        missing?: string;
        revisions?: { '*'?: string }[];
        imageinfo?: { url?: string; mime?: string }[];
      }
    >;
  };
}

/** Every answer of a query, following `continue`; the bodies go to `raw` as received. */
export async function query(
  fetchFn: Fetch,
  params: Record<string, string>,
  raw: string[],
  delayMs: number | undefined,
): Promise<Answer[]> {
  const answers: Answer[] = [];
  let next: Record<string, string> = {};
  do {
    const body = await ask(fetchFn, apiUrl({ ...params, ...next }), delayMs);
    raw.push(body);
    const answer = JSON.parse(body) as Answer;
    if (answer.error || !answer.query)
      throw new Error(`Yugipedia answered ${JSON.stringify(answer.error ?? body).slice(0, 300)}`);
    answers.push(answer);
    next = answer.continue ?? {};
  } while (Object.keys(next).length);
  return answers;
}

/** Every gallery title (about 7,200, fifteen requests). */
export async function listGalleries(fetchFn: Fetch, raw: string[], delayMs?: number) {
  const answers = await query(
    fetchFn,
    { list: 'allpages', apnamespace: String(GALLERY_NAMESPACE), aplimit: 'max' },
    raw,
    delayMs,
  );
  return answers.flatMap((a) => (a.query?.allpages ?? []).map((p) => p.title));
}

/** The wikitext of each page (absent for a missing one). */
export async function readPages(
  fetchFn: Fetch,
  titles: string[],
  raw: string[],
  delayMs?: number,
): Promise<Map<string, string>> {
  const texts = new Map<string, string>();
  for (const batch of batches(titles, TITLES_PER_REQUEST))
    for (const answer of await query(
      fetchFn,
      { prop: 'revisions', rvprop: 'content', titles: batch.join('|') },
      raw,
      delayMs,
    ))
      for (const p of Object.values(answer.query?.pages ?? {})) {
        const text = p.revisions?.[0]?.['*'];
        if (text !== undefined) texts.set(p.title, text);
      }
  return texts;
}

/** The URL of each file that exists and that the mirror can copy (an image, a safe name). */
export async function fileUrls(
  fetchFn: Fetch,
  files: string[],
  raw: string[],
  delayMs?: number,
): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  for (const batch of batches(files, TITLES_PER_REQUEST))
    for (const answer of await query(
      fetchFn,
      {
        prop: 'imageinfo',
        iiprop: 'url|mime',
        titles: batch.map((f) => `File:${f}`).join('|'),
      },
      raw,
      delayMs,
    )) {
      // The wiki capitalizes the first letter (`File:Foo`), so the answer may name another title.
      const asked = new Map(
        (answer.query?.normalized ?? []).map((n) => [n.to, n.from.replace(/^File:/, '')]),
      );
      for (const p of Object.values(answer.query?.pages ?? {})) {
        const info = p.imageinfo?.[0];
        const url = info?.url;
        if (p.missing !== undefined || !url || !info.mime?.startsWith('image/')) continue;
        if (!extension(url) || !sourceId('yugioh', {}, url)) continue;
        urls.set(asked.get(p.title) ?? p.title.replace(/^File:/, ''), url);
      }
    }
  return urls;
}

export type PrintArtworks = {
  id: string;
  number: string;
  /** null for YGOPRODeck's placeholder (`New`), until `resolveRarities` names it. */
  rarity: string | null;
  /** The alt code of the row `resolveRarities` gave the print (`external_ids.gallery_rarity`). */
  alt: string | null;
  /** YGOPRODeck's artwork count of the card (`external_ids.artworks`), when more than one. */
  artworks: number | null;
  /** Languages with a localization row (other than `en`). */
  langs: string[];
  /** A print of one language only (`external_ids.language`, a German-only code), else null. */
  language: string | null;
};

export interface ArtworkChoice {
  printId: string;
  /** `en`: the print itself; else the localization. */
  lang: string;
  /** The print's own files (its rarity and alt code). */
  files: string[];
  /** Then the same artwork in a rarity whose scan may stand in (`yugiohScanBacks`), plainest first. */
  siblings: string[];
  alt: string;
  /** A rarity printed with an artwork of its own (`YUGIOH_RARITY_ARTWORK`): its scan is shown. */
  ownArt: boolean;
}

/** The pages sorted best first, and the rows of a number in them with the page's language. */
function numberRows(setCode: string, pages: { page: GalleryPage; rows: GalleryRow[] }[]) {
  const ordered = [...pages].sort((a, b) => pageRank(a.page) - pageRank(b.page));
  return (number: string) =>
    ordered.flatMap(({ page, rows }) =>
      rows
        .filter((r) => {
          const code = parseSetCode(r.code);
          return (
            code.setCode.toLowerCase() === setCode && numberKey(code.number) === numberKey(number)
          );
        })
        .map((r) => ({ ...r, lang: page.lang })),
    );
}

export interface RarityChoice {
  printId: string;
  /** Yugipedia's name of the rarity (`Ultra Rare`). */
  rarity: string;
  abbr: string;
  alt: string;
}

/**
 * The rarity of a print YGOPRODeck lists with a placeholder (VB-117: MAMO's `New` is the Extended
 * Art Ultra Rare of each Grand Master Rare card): the one row (rarity and alt code) of its number
 * in its language's galleries that no other print of the number has. A known print has the row of
 * its rarity (and its own alt code, once resolved), the first one of several. Two placeholders
 * of one number, or more than one row left: no guess.
 */
export function resolveRarities(
  setCode: string,
  prints: PrintArtworks[],
  pages: { page: GalleryPage; rows: GalleryRow[] }[],
): RarityChoice[] {
  const rowsOf = numberRows(setCode, pages);
  const groups = new Map<string, PrintArtworks[]>();
  for (const p of prints) {
    const key = `${p.language ?? 'en'}|${numberKey(p.number)}`;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  const choices: RarityChoice[] = [];
  for (const group of groups.values()) {
    const unknown = group.filter((p) => !(p.rarity && rarityAbbr(p.rarity)));
    const [print] = unknown;
    if (!print || unknown.length > 1) continue;
    const rows = rowsOf(print.number).filter((r) => r.lang === (print.language ?? 'en'));
    const pair = (rarity: string, alt: string) => `${rarity}|${alt}`;
    const taken = new Set(
      group.flatMap((p) => {
        const abbr = p.rarity && rarityAbbr(p.rarity);
        const alt = abbr && (p.alt ?? rows.find((r) => r.rarity === abbr)?.alt);
        return abbr && alt !== undefined && alt !== null ? [pair(abbr, alt)] : [];
      }),
    );
    const free = [...new Map(rows.map((r) => [pair(r.rarity, r.alt), r])).values()].filter(
      (r) => !taken.has(pair(r.rarity, r.alt)),
    );
    const [row] = free;
    const rarity = row && YUGIOH_RARITIES.find(([abbr]) => abbr === row.rarity)?.[1];
    if (row && rarity && free.length === 1)
      choices.push({ printId: print.id, rarity, abbr: row.rarity, alt: row.alt });
  }
  return choices;
}

/**
 * The files to try per print and language: the prints of a card with several artworks and those
 * a gallery row gives an alt code; the others keep the passcode image. The first row of the
 * print's number and rarity (and alt code, `resolveRarities`) in the best page of the language
 * names the artwork; a print several rows share (LCKC-EN001 in four Blue-Eyes artworks) takes the
 * first. A shown artwork (an alt code, `ownArt`) may fall back to a sibling's scan.
 */
export function planArtworks(
  setCode: string,
  prints: PrintArtworks[],
  pages: { page: GalleryPage; rows: GalleryRow[] }[],
): ArtworkChoice[] {
  const rowsOf = numberRows(setCode, pages);
  /** The alt code of a row's artwork across rarities: a Grand Master Rare is the `EA` one. */
  const art = (rarity: string, alt: string) => alt || YUGIOH_RARITY_ARTWORK[rarity] || '';
  const tier = (rarity: string) => YUGIOH_FOIL_TIERS[rarity] ?? Infinity;
  const choices: ArtworkChoice[] = [];
  for (const p of prints) {
    const rarity = p.rarity && rarityAbbr(p.rarity);
    if (!rarity) continue;
    const rows = rowsOf(p.number);
    if (!((p.artworks ?? 0) > 1 || rows.some((r) => r.alt))) continue;
    // A print of one language only (its own scan on the print) reads that language's page alone.
    for (const lang of p.language ? ['en'] : ['en', ...p.langs]) {
      const own = rows.filter((r) => r.lang === (p.language ?? lang));
      const alt = own.find((r) => r.rarity === rarity && (p.alt === null || r.alt === p.alt))?.alt;
      if (alt === undefined) continue;
      const ownArt = !alt && rarity in YUGIOH_RARITY_ARTWORK;
      // An alt code names one artwork within its gallery, so its scan in another rarity is the
      // same picture; a row without one may be another artwork in the other rarities (RA04's
      // German Aleister is the alternate art in Platinum Secret Rare only, with no code), and is
      // not shown anyway (the passcode render is).
      const files = own.filter((r) => r.rarity === rarity && r.alt === alt).map((r) => r.file);
      const siblings =
        alt || ownArt
          ? own
              .filter(
                (r) =>
                  r.rarity !== rarity &&
                  art(r.rarity, r.alt) === art(rarity, alt) &&
                  yugiohScanBacks(r.rarity, rarity),
              )
              .sort((a, b) => tier(a.rarity) - tier(b.rarity))
              .map((r) => r.file)
          : [];
      choices.push({
        printId: p.id,
        lang,
        files: [...new Set(files)],
        siblings: [...new Set(siblings)],
        alt,
        ownArt,
      });
    }
  }
  return choices;
}

export interface Artwork {
  file: string;
  url: string;
  alt?: string;
  /** A rarity printed with an artwork of its own (`ArtworkChoice.ownArt`): shown (`showsScan`). */
  own_art?: true;
  /** Another rarity's scan of the same artwork stands in for the print's missing one. */
  sibling?: true;
}

/** Writes the rarities `resolveRarities` found, on prints still without one; returns the rows. */
export async function writeRarities(db: Db, rows: RarityChoice[]): Promise<number> {
  if (!rows.length) return 0;
  const done = await db.execute(sql`
    update prints set rarity = v.rarity, external_ids = external_ids
      || jsonb_build_object(${GALLERY_RARITY}::text, jsonb_build_object('rarity', v.abbr, 'alt', v.alt))
    from jsonb_to_recordset(${JSON.stringify(rows.map((r) => ({ ...r, id: r.printId })))}::jsonb)
      as v(id uuid, rarity text, abbr text, alt text)
    where prints.id = v.id and prints.rarity is null`);
  return done.rowCount ?? 0;
}

/**
 * Writes each print's (and localization's) artwork; returns the rows changed. The `image_key`
 * stays until the mirror has stored the new scan (`needsWork` plans a key that does not name it).
 */
export async function writeArtworks(
  db: Db,
  rows: { printId: string; lang: string; artwork: Artwork }[],
): Promise<number> {
  const json = (en: boolean) =>
    JSON.stringify(
      rows
        .filter((r) => (r.lang === 'en') === en)
        .map((r) => ({ id: r.printId, lang: r.lang, artwork: r.artwork })),
    );
  const printsDone = await db.execute(sql`
    update prints set external_ids = external_ids || jsonb_build_object(${ARTWORK}::text, v.artwork)
    from jsonb_to_recordset(${json(true)}::jsonb) as v(id uuid, lang text, artwork jsonb)
    where prints.id = v.id and prints.external_ids -> ${ARTWORK}::text is distinct from v.artwork`);
  const locsDone = await db.execute(sql`
    update print_localizations l
    set external_ids = l.external_ids || jsonb_build_object(${ARTWORK}::text, v.artwork)
    from jsonb_to_recordset(${json(false)}::jsonb) as v(id uuid, lang text, artwork jsonb)
    where l.print_id = v.id and l.lang = v.lang
      and l.external_ids -> ${ARTWORK}::text is distinct from v.artwork`);
  return (printsDone.rowCount ?? 0) + (locsDone.rowCount ?? 0);
}

/**
 * Our sets (by code) whose name is not their gallery's (VB-109): the wiki's set name. Taken from
 * the local catalog's Yu-Gi-Oh! sets without a gallery match on 2026-10-10; a gallery's rows are
 * filtered by set code, so a page shared by several sets (Pharaoh Tour) serves each. Still
 * without a TCG gallery then: 21cc (Remote Duel Extravaganza), mams (Magnificent Maestros, not
 * released), tkn1 (San Diego Comic-Con tokens), typ1 (THANK YOU PACK), wi26 (Winner's Pack
 * 2026-2027, OCG pages only).
 */
export const GALLERY_NAMES: Record<string, string> = {
  blvo: 'Blazing Vortex',
  liov: 'Lightning Overdrive',
  fmr: 'Yu-Gi-Oh! Forbidden Memories Premium Edition promotional cards',
  pt02: 'Pharaoh Tour promotional cards',
  wc09: "Yu-Gi-Oh! 5D's World Championship 2009: Stardust Accelerator promotional cards",
};

export interface PlannedSet {
  code: string;
  titles: string[];
}

/**
 * Our Yu-Gi-Oh! sets with a TCG gallery (or set list) among `titles`, less those read within
 * COOL_DOWN_DAYS before `date` (the `app_meta` map `metaKey`).
 */
export async function planSets(
  db: Db,
  titles: string[],
  date: string,
  metaKey = GALLERIES_CHECKED_KEY,
): Promise<PlannedSet[]> {
  const byName = new Map<string, string[]>();
  for (const page of titles.map(parseGalleryTitle))
    if (page)
      byName.set(setNameKey(page.set), [...(byName.get(setNameKey(page.set)) ?? []), page.title]);
  const [meta] = await db
    .select({ value: appMeta.value })
    .from(appMeta)
    .where(eq(appMeta.key, metaKey));
  const checked = JSON.parse(meta?.value ?? '{}') as Record<string, string>;
  const since = new Date(Date.parse(date) - COOL_DOWN_DAYS * 86_400_000).toISOString().slice(0, 10);
  const ours = await db
    .select({
      code: sets.code,
      name: sets.name,
      // A placeholder rarity (VB-117) the gallery may name once YGOPRODeck's import has left it
      // null: looked at again the next day, not after the cool-down.
      // Spelled out: drizzle writes a select field's columns unqualified.
      unresolved: sql<boolean>`exists (select from prints up where up.set_id = "sets"."id"
        and up.rarity is null)`,
    })
    .from(sets)
    .where(eq(sets.gameId, 'yugioh'))
    .orderBy(sets.code);
  return ours.flatMap((s) => {
    const pages = byName.get(setNameKey(GALLERY_NAMES[s.code] ?? s.name));
    const due = (checked[s.code] ?? '') <= (s.unresolved ? date.slice(0, 10) : since);
    return pages && due ? [{ code: s.code, titles: pages }] : [];
  });
}

/** Whether the YGOPRODeck import has written `external_ids.artworks` on any print yet. */
async function hasArtworkCounts(db: Db): Promise<boolean> {
  const result = await db.execute<{ ok: boolean }>(sql`
    select exists (select 1 from prints p join sets s on s.id = p.set_id
      where s.game_id = 'yugioh' and p.external_ids ? 'artworks') as ok`);
  return result.rows[0]?.ok ?? false;
}

/** The prints of these sets with what planArtworks (and set-lists.ts' planCodes) needs. */
export async function printsOf(db: Db, codes: string[]) {
  const result = await db.execute<PrintArtworks & { set_code: string }>(sql`
    select p.id, s.code as set_code, p.number, p.rarity,
      p.external_ids -> ${GALLERY_RARITY}::text ->> 'alt' as alt,
      (p.external_ids ->> 'artworks')::int as artworks, p.external_ids ->> 'language' as language,
      coalesce((select array_agg(l.lang order by l.lang) from print_localizations l
        where l.print_id = p.id and l.lang in (${sql.join(
          GALLERY_LANGS.slice(1).map((l) => sql`${l}`),
          sql`, `,
        )})), '{}') as langs
    from prints p join sets s on s.id = p.set_id
    where s.game_id = 'yugioh' and s.code in (${sql.join(
      codes.map((c) => sql`${c}`),
      sql`, `,
    )})`);
  return result.rows;
}

export type GalleryStats = {
  sets: number;
  pages: number;
  /** Prints and localizations with an artwork to resolve. */
  planned: number;
  /** Those with an existing scan. */
  found: number;
  /** Rows whose artwork changed (their image is mirrored again). */
  written: number;
  /** Prints whose placeholder rarity the gallery named (`resolveRarities`). */
  rarities: number;
};

/** Reads one chunk of sets' galleries and writes the artworks it resolves. */
async function importSets(
  deps: ImportDeps,
  planned: PlannedSet[],
  rawKey: string,
  date: string,
  delayMs: number | undefined,
): Promise<GalleryStats> {
  const raw: string[] = [];
  const codes = planned.map((s) => s.code);
  const prints = await deps.withDb((db) => printsOf(db, codes));
  // Only the galleries of languages the set's prints have.
  const pages = planned.flatMap((s) => {
    const langs = new Set([
      'en',
      ...prints
        .filter((p) => p.set_code === s.code)
        .flatMap((p) => (p.language ? [p.language] : p.langs)),
    ]);
    return s.titles.flatMap((t) => {
      const page = parseGalleryTitle(t);
      return page && langs.has(page.lang) ? [page] : [];
    });
  });
  const texts = await readPages(
    deps.fetch,
    pages.map((p) => p.title),
    raw,
    delayMs,
  );
  const galleries = (s: PlannedSet) =>
    pages
      .filter((p) => s.titles.includes(p.title))
      .map((page) => ({ page, rows: parseGallery(texts.get(page.title) ?? '', page) }));
  const rarities = planned.flatMap((s) =>
    resolveRarities(
      s.code,
      prints.filter((p) => p.set_code === s.code),
      galleries(s),
    ),
  );
  // The resolved prints take their artwork in this run.
  for (const r of rarities) {
    const p = prints.find((x) => x.id === r.printId);
    if (p) Object.assign(p, { rarity: r.rarity, alt: r.alt });
  }
  const choices = planned.flatMap((s) =>
    planArtworks(
      s.code,
      prints.filter((p) => p.set_code === s.code),
      galleries(s),
    ),
  );
  const urls = await fileUrls(
    deps.fetch,
    [...new Set(choices.flatMap((c) => [...c.files, ...c.siblings]))],
    raw,
    delayMs,
  );
  const resolved = choices.flatMap((c) => {
    const own = c.files.find((f) => urls.has(f));
    const file = own ?? c.siblings.find((f) => urls.has(f));
    if (!file) return [];
    const artwork: Artwork = {
      file,
      url: urls.get(file) ?? '',
      ...(c.alt ? { alt: c.alt } : {}),
      ...(c.ownArt ? { own_art: true as const } : {}),
      ...(own ? {} : { sibling: true as const }),
    };
    return [{ printId: c.printId, lang: c.lang, artwork }];
  });
  await deps.raw.put(rawKey, `[${raw.join(',')}]`, { contentType: 'application/json' });
  const [written, resolvedRarities] = await deps.withDb(async (db) => {
    const r = await writeRarities(db, rarities);
    const n = await writeArtworks(db, resolved);
    await markChecked(db, codes, date, GALLERIES_CHECKED_KEY);
    return [n, r];
  });
  return {
    sets: planned.length,
    pages: texts.size,
    planned: choices.length,
    found: resolved.length,
    written,
    rarities: resolvedRarities,
  };
}

export interface GalleryImportOptions {
  /** `IMPORT_ENV`: raw answers under `raw/<env>/yugipedia/galleries/<date>/`. */
  env: string;
  date: string;
  /** Wait before every request; `ask`'s CRAWL_DELAY_MS when unset. Tests pass 0. */
  delayMs?: number;
}

/** The gallery import as Workflow steps, recorded as `import_runs` source `yugipedia-galleries`. */
export async function runGalleryImport(
  deps: ImportDeps,
  step: StepRunner,
  opts: GalleryImportOptions,
) {
  const runId = await step('galleries: start run', () =>
    deps.withDb(async (db) => {
      const [run] = await db
        .insert(importRuns)
        .values({ source: 'yugipedia-galleries', kind: 'full' })
        .returning({ id: importRuns.id });
      if (!run) throw new Error('import_runs insert returned no row');
      return run.id;
    }),
  );
  const raw = `raw/${opts.env}/yugipedia/galleries/${opts.date}`;
  const work = `work/${opts.env}/yugipedia-galleries/${runId}`;
  const n = (i: number) => String(i).padStart(5, '0');
  let result;
  try {
    const chunks = await step('galleries: plan', async () => {
      // The prints of multi-artwork cards are found by `external_ids.artworks`, which only the
      // YGOPRODeck import writes: before it has, a run would cool every set down without them.
      if (!(await deps.withDb(hasArtworkCounts))) {
        log('warn', {
          message:
            'no Yu-Gi-Oh! print has external_ids.artworks yet, run the YGOPRODeck import first',
          runId,
        });
        return 0;
      }
      const bodies: string[] = [];
      const titles = await listGalleries(deps.fetch, bodies, opts.delayMs);
      await deps.raw.put(`${raw}/titles.json`, `[${bodies.join(',')}]`, {
        contentType: 'application/json',
      });
      const planned = await deps.withDb((db) => planSets(db, titles, opts.date));
      const parts = batches(planned, SETS_PER_STEP);
      for (const [i, part] of parts.entries())
        await deps.raw.put(
          chunkKey(work, i),
          `${part.map((s) => JSON.stringify(s)).join('\n')}\n`,
          { contentType: 'application/x-ndjson' },
        );
      return parts.length;
    });
    const stats: GalleryStats = {
      sets: 0,
      pages: 0,
      planned: 0,
      found: 0,
      written: 0,
      rarities: 0,
    };
    for (let i = 0; i < chunks; i++) {
      const r = await step(`galleries ${n(i)}`, async () => {
        const planned = (await readChunk(deps.raw, chunkKey(work, i))).map(
          (l) => JSON.parse(l) as PlannedSet,
        );
        return importSets(deps, planned, `${raw}/sets-${n(i)}.json`, opts.date, opts.delayMs);
      });
      for (const k of Object.keys(stats) as (keyof GalleryStats)[]) stats[k] += r[k];
    }
    await step('galleries: finish run', () =>
      deps.withDb((db) =>
        finishRun(db, runId, stats, { bump: stats.written + stats.rarities > 0 }),
      ),
    );
    result = { runId, stats };
  } catch (err) {
    await step('galleries: fail run', () => deps.withDb((db) => failRun(db, runId, String(err))));
    throw err;
  }
  try {
    await step('galleries: clean up chunks', () => deletePrefix(deps.raw, work));
  } catch (err) {
    log('warn', { message: 'chunk cleanup failed', runId, prefix: work, error: String(err) });
  }
  return result;
}
