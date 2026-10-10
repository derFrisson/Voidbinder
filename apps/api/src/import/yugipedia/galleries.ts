import { eq, sql } from 'drizzle-orm';
import { appMeta, importRuns, sets } from '../../db/schema';
import { log } from '../../middleware/log';
import { extension, sourceId } from '../images';
import type { ImportDeps, StepRunner } from '../scryfall/pipeline';
import { chunkKey, deletePrefix, readChunk, type Fetch } from '../scryfall/source';
import { failRun, finishRun, type Db } from '../scryfall/write';
import { parseSetCode } from '../ygoprodeck/map';
import { batches, purgeEdgeCache } from '../util';
import { ARTWORK, COOL_DOWN_DAYS, markChecked } from './pipeline';
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
// print, the others on their localization) and loses its `image_key`, so the image mirror copies
// the scan into R2 (src/import/images.ts reads `artwork.url` before YGOPRODeck's `image_url`).
// The alt codes are each gallery's own (the German RA04 page has no `AA` where the English one
// has), so a code is a file name part, never a fact about the artwork across languages. A row
// whose scan is missing (RA05's Starlight Rares) falls back to the same alt code in another
// rarity of the set; a print without a matching row or scan keeps the passcode image. One request per
// second; a set is looked at again after COOL_DOWN_DAYS.

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

/** Module:Data/static/rarity/data (2026-10-10): abbreviation (in file names) and name. */
const RARITIES: [string, string][] = [
  ['C', 'Common'],
  ['NR', 'Normal Rare'],
  ['SP', 'Short Print'],
  ['SSP', 'Super Short Print'],
  ['R', 'Rare'],
  ['SR', 'Super Rare'],
  ['UR', 'Ultra Rare'],
  ['UtR', 'Ultimate Rare'],
  ['GR', 'Ghost Rare'],
  ['HGR', 'Holographic Rare'],
  ['ScR', 'Secret Rare'],
  ['PScR', 'Prismatic Secret Rare'],
  ['UScR', 'Ultra Secret Rare'],
  ['ScUR', 'Secret Ultra Rare'],
  ['EScR', 'Extra Secret Rare'],
  ['20ScR', '20th Secret Rare'],
  ['10000ScR', '10000 Secret Rare'],
  ['QCScR', 'Quarter Century Secret Rare'],
  ['StR', 'Starlight Rare'],
  ['GMR', 'Grand Master Rare'],
  ['GUR', 'Gold Rare'],
  ['GScR', 'Gold Secret Rare'],
  ['GGR', 'Ghost/Gold Rare'],
  ['PGR', 'Premium Gold Rare'],
  ['PlR', 'Platinum Rare'],
  ['PlScR', 'Platinum Secret Rare'],
  ['MLR', 'Millennium Rare'],
  ['MLSR', 'Millennium Super Rare'],
  ['MLUR', 'Millennium Ultra Rare'],
  ['MLScR', 'Millennium Secret Rare'],
  ['MLGR', 'Millennium Gold Rare'],
  ['NPR', 'Normal Parallel Rare'],
  ['RPR', 'Rare Parallel Rare'],
  ['SPR', 'Super Parallel Rare'],
  ['UPR', 'Ultra Parallel Rare'],
  ['ScPR', 'Secret Parallel Rare'],
  ['EScPR', 'Extra Secret Parallel Rare'],
  ['HGPR', 'Holographic Parallel Rare'],
  ['DNPR', 'Duel Terminal Normal Parallel Rare'],
  ['DNRPR', 'Duel Terminal Normal Rare Parallel Rare'],
  ['DRPR', 'Duel Terminal Rare Parallel Rare'],
  ['DSPR', 'Duel Terminal Super Parallel Rare'],
  ['DUPR', 'Duel Terminal Ultra Parallel Rare'],
  ['DScPR', 'Duel Terminal Secret Parallel Rare'],
  ['KCC', 'Kaiba Corporation Common'],
  ['KCR', 'Kaiba Corporation Rare'],
  ['KCSR', 'Kaiba Corporation Super Rare'],
  ['KCUR', 'Kaiba Corporation Ultra Rare'],
  ['URBlue', 'Ultra Rare (Special Blue Version)'],
  ['URPurple', 'Ultra Rare (Special Purple Version)'],
  ['URRed', 'Ultra Rare (Special Red Version)'],
  ['ScRBlue', 'Secret Rare (Special Blue Version)'],
  ['ScRRed', 'Secret Rare (Special Red Version)'],
  ['QCScRSV', 'Quarter Century Secret Rare (Special Version)'],
  ['HFR', 'Holofoil Rare'],
  ['SFR', 'Starfoil Rare'],
  ['MSR', 'Mosaic Rare'],
  ['SHR', 'Shatterfoil Rare'],
  ['CR', "Collector's Rare"],
  ['URPR', "Ultra Rare (Pharaoh's Rare)"],
];

/** The module's normalization: `Starlight Rare`, `StR` and `starlight` are one rarity. */
const rarityKey = (v: string) =>
  v
    .trim()
    .toLowerCase()
    .replace(/[/\-_'()]/g, '')
    .replace(/ rare$/, '')
    .replace(/s$/, '')
    .replace(/\s/g, '');

const ABBR = new Map<string, string>([
  ...RARITIES.flatMap(([abbr, name]): [string, string][] => [
    [rarityKey(abbr), abbr],
    [rarityKey(name), abbr],
  ]),
  // The module's other spellings.
  ['n', 'C'],
  ['altr', 'StR'],
  ['alternate', 'StR'],
  ['mr', 'MLR'],
  ['prismatic', 'PScR'],
  ['goldultra', 'GUR'],
  ['pharaoh', 'URPR'],
]);

/** A rarity name or abbreviation → the abbreviation of the file names, null when unknown. */
export const rarityAbbr = (rarity: string) => ABBR.get(rarityKey(rarity)) ?? null;

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

/** A TCG gallery title in a language we store, else null (OCG, Korean, Asian English, …). */
export function parseGalleryTitle(title: string): GalleryPage | null {
  const m = /^Set Card Galleries:(.+) \(TCG-([A-Z]+)(?:-([A-Z0-9]+))?\)$/.exec(title);
  const [, set = '', region = '', edition] = m ?? [];
  const lang = REGION_LANG[region];
  if (!lang) return null;
  return { title, set, region, edition: edition ?? null, lang };
}

/** Pages of one language best first: `EN` before `NA` before `EU`, 1st Edition before Unlimited. */
const pageRank = (p: GalleryPage) => {
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
 * The rows of every `{{Set gallery}}` on a gallery page with the file name the template builds.
 * Rows without a card number (`abbr=`) and with an unknown rarity are left out.
 */
export function parseGallery(wikitext: string, page: GalleryPage): GalleryRow[] {
  const rows: GalleryRow[] = [];
  const open = /\{\{\s*Set gallery\s*\|/gi;
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
 * A print number without its region (`EN141`, `DE141`, `E001` → `141`/`001`), so a German or a
 * European English row finds the print YGOPRODeck keys by the English (or North American) code.
 * ponytail: a regex over the known region tokens; a number that starts with one of the letters
 * without being a region would lose it on both sides alike.
 */
export const numberKey = (number: string) =>
  number.replace(/^(EN|DE|FR|IT|SP|PT|E|G|F|I|S|P)(?=[A-Z]?\d)/, '');

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
async function query(
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
  rarity: string | null;
  /** YGOPRODeck's artwork count of the card (`external_ids.artworks`), when more than one. */
  artworks: number | null;
  /** Languages with a localization row (other than `en`). */
  langs: string[];
};

export interface ArtworkChoice {
  printId: string;
  /** `en`: the print itself; else the localization. */
  lang: string;
  /** Files to try, best first: the print's rarity, then the same artwork in another rarity. */
  files: string[];
  alt: string;
}

/**
 * The files to try per print and language: the prints of a card with several artworks and those
 * a gallery row gives an alt code; the others keep the passcode image. The first row of the
 * print's number and rarity in the best page of the language names the artwork (its alt code);
 * a print several rows share (LCKC-EN001 in four Blue-Eyes artworks) takes the first.
 */
export function planArtworks(
  setCode: string,
  prints: PrintArtworks[],
  pages: { page: GalleryPage; rows: GalleryRow[] }[],
): ArtworkChoice[] {
  const ordered = [...pages].sort((a, b) => pageRank(a.page) - pageRank(b.page));
  const rowsOf = (p: PrintArtworks) =>
    ordered.flatMap(({ page, rows }) =>
      rows
        .filter((r) => {
          const code = parseSetCode(r.code);
          return (
            code.setCode.toLowerCase() === setCode && numberKey(code.number) === numberKey(p.number)
          );
        })
        .map((r) => ({ ...r, lang: page.lang })),
    );
  const choices: ArtworkChoice[] = [];
  for (const p of prints) {
    const rarity = p.rarity && rarityAbbr(p.rarity);
    if (!rarity) continue;
    const rows = rowsOf(p);
    if (!((p.artworks ?? 0) > 1 || rows.some((r) => r.alt))) continue;
    for (const lang of ['en', ...p.langs]) {
      const own = rows.filter((r) => r.lang === lang);
      const alt = own.find((r) => r.rarity === rarity)?.alt;
      if (alt === undefined) continue;
      // An alt code names one artwork within its gallery, so its scan in another rarity is the
      // same picture; a row without one may be another artwork in the other rarities (RA04's
      // German Aleister is the alternate art in Platinum Secret Rare only, with no code).
      const same = own.filter((r) => r.alt === alt);
      const files = [
        ...same.filter((r) => r.rarity === rarity),
        ...(alt ? same.filter((r) => r.rarity !== rarity) : []),
      ].map((r) => r.file);
      choices.push({ printId: p.id, lang, files: [...new Set(files)], alt });
    }
  }
  return choices;
}

export interface Artwork {
  file: string;
  url: string;
  alt?: string;
}

/**
 * Writes each print's (and localization's) artwork and clears its `image_key` when the artwork
 * changed, so the mirror copies the new scan; returns the rows changed.
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
    update prints set external_ids = external_ids || jsonb_build_object(${ARTWORK}::text, v.artwork),
      image_key = null
    from jsonb_to_recordset(${json(true)}::jsonb) as v(id uuid, lang text, artwork jsonb)
    where prints.id = v.id and prints.external_ids -> ${ARTWORK}::text is distinct from v.artwork`);
  const locsDone = await db.execute(sql`
    update print_localizations l
    set external_ids = l.external_ids || jsonb_build_object(${ARTWORK}::text, v.artwork),
      image_key = null
    from jsonb_to_recordset(${json(false)}::jsonb) as v(id uuid, lang text, artwork jsonb)
    where l.print_id = v.id and l.lang = v.lang
      and l.external_ids -> ${ARTWORK}::text is distinct from v.artwork`);
  return (printsDone.rowCount ?? 0) + (locsDone.rowCount ?? 0);
}

interface PlannedSet {
  code: string;
  titles: string[];
}

/** Our Yu-Gi-Oh! sets with a TCG gallery, less those read within COOL_DOWN_DAYS before `date`. */
export async function planSets(db: Db, titles: string[], date: string): Promise<PlannedSet[]> {
  const byName = new Map<string, string[]>();
  for (const page of titles.map(parseGalleryTitle))
    if (page)
      byName.set(setNameKey(page.set), [...(byName.get(setNameKey(page.set)) ?? []), page.title]);
  const [meta] = await db
    .select({ value: appMeta.value })
    .from(appMeta)
    .where(eq(appMeta.key, GALLERIES_CHECKED_KEY));
  const checked = JSON.parse(meta?.value ?? '{}') as Record<string, string>;
  const since = new Date(Date.parse(date) - COOL_DOWN_DAYS * 86_400_000).toISOString().slice(0, 10);
  const ours = await db
    .select({ code: sets.code, name: sets.name })
    .from(sets)
    .where(eq(sets.gameId, 'yugioh'))
    .orderBy(sets.code);
  return ours.flatMap((s) => {
    const pages = byName.get(setNameKey(s.name));
    return pages && (checked[s.code] ?? '') <= since ? [{ code: s.code, titles: pages }] : [];
  });
}

/** The prints of these sets with what planArtworks needs. */
async function printsOf(db: Db, codes: string[]) {
  const result = await db.execute<PrintArtworks & { set_code: string }>(sql`
    select p.id, s.code as set_code, p.number, p.rarity,
      (p.external_ids ->> 'artworks')::int as artworks,
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
      ...prints.filter((p) => p.set_code === s.code).flatMap((p) => p.langs),
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
  const choices = planned.flatMap((s) =>
    planArtworks(
      s.code,
      prints.filter((p) => p.set_code === s.code),
      pages
        .filter((p) => s.titles.includes(p.title))
        .map((page) => ({ page, rows: parseGallery(texts.get(page.title) ?? '', page) })),
    ),
  );
  const urls = await fileUrls(
    deps.fetch,
    [...new Set(choices.flatMap((c) => c.files))],
    raw,
    delayMs,
  );
  const resolved = choices.flatMap((c) => {
    const file = c.files.find((f) => urls.has(f));
    return file
      ? [
          {
            printId: c.printId,
            lang: c.lang,
            artwork: { file, url: urls.get(file) ?? '', ...(c.alt ? { alt: c.alt } : {}) },
          },
        ]
      : [];
  });
  await deps.raw.put(rawKey, `[${raw.join(',')}]`, { contentType: 'application/json' });
  const written = await deps.withDb(async (db) => {
    const n = await writeArtworks(db, resolved);
    await markChecked(db, codes, date, GALLERIES_CHECKED_KEY);
    return n;
  });
  return {
    sets: planned.length,
    pages: texts.size,
    planned: choices.length,
    found: resolved.length,
    written,
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
    const stats: GalleryStats = { sets: 0, pages: 0, planned: 0, found: 0, written: 0 };
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
      deps.withDb((db) => finishRun(db, runId, stats, { bump: stats.written > 0 })),
    );
    if (stats.written) await purgeEdgeCache(deps, step, ['catalog']);
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
