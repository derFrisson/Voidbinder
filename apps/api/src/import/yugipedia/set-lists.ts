import { sql } from 'drizzle-orm';
import { importRuns } from '../../db/schema';
import { log } from '../../middleware/log';
import type { ImportDeps, StepRunner } from '../scryfall/pipeline';
import { chunkKey, deletePrefix, readChunk, type Fetch } from '../scryfall/source';
import { failRun, finishRun, type Db } from '../scryfall/write';
import { parseSetCode } from '../ygoprodeck/map';
import { batches, purgeEdgeCache } from '../util';
import {
  numberKey,
  pageRank,
  parseGalleryTitle,
  planSets,
  printsOf,
  query,
  readPages,
  templateCalls,
  type GalleryPage,
  type PlannedSet,
  type PrintArtworks,
} from './galleries';
import { markChecked } from './pipeline';

// The Yu-Gi-Oh! codes as printed in each language (VB-94), from Yugipedia's set lists. The
// YGOPRODeck import seeds every localization's `external_ids.set_code` by rule (`ruleCode`:
// `BLGG-EN024` → `BLGG-DE024`, `LON-065` → `LON-DE065`), right for about 84 % (PT 62 %). Namespace
// 3006 `Set Card Lists` (checked 2026-10-10) holds one page per set and region, `<set> (TCG-DE)`
// (no edition), whose `{{Set list|…}}` rows are `code; name; rarity` (`LON-G065; Dark Necrofear;
// UR`): 7,624 pages, of them TCG EN 1,129, DE 749, FR 745, IT 742, SP 702, PT 469 (and NA, EU, AU,
// FC on old sets). They are what the card pages' `de_sets` lists show, at 50 pages a request
// instead of one request per card. A print's number (`numberKey`, so `LON-065`, `LON-E065` and
// `LON-G065` are one) found in a set's lists gets the row's code in each of its localizations'
// languages (also under another set code: French LON is `LDC-F065`), `set_code_source:
// 'yugipedia'`; a language whose list lacks the number (or which has
// no list for the set) was never printed so, and its code is dropped (the source stays, so the
// rule does not seed it again). A number no list names (our code is not the wiki's,
// `YS15-ENF27`) keeps the rule's code. The gallery pages (galleries.ts) carry the same codes but
// exist in other languages for about 250 sets only. One request per second; a set is read again
// after COOL_DOWN_DAYS.

/** The namespace `Set Card Lists`. */
export const SET_LIST_NAMESPACE = 3006;
/** Sets per Workflow step: about 250 pages, five requests. */
export const SET_LISTS_PER_STEP = 50;
/** `app_meta` key of the map set code → UTC day its lists were last read. */
export const SET_LISTS_CHECKED_KEY = 'yugipedia_set_lists_checked';

/** Every set list title but redirects (about 7,600, sixteen requests). */
export async function listSetLists(fetchFn: Fetch, raw: string[], delayMs?: number) {
  const answers = await query(
    fetchFn,
    {
      list: 'allpages',
      apnamespace: String(SET_LIST_NAMESPACE),
      // A redirect's text has no rows: read under its old title it would drop every code.
      apfilterredir: 'nonredirects',
      aplimit: 'max',
    },
    raw,
    delayMs,
  );
  return answers.flatMap((a) => (a.query?.allpages ?? []).map((p) => p.title));
}

/** The codes of every `{{Set list}}` row on a set list page, as printed (`LON-G065`). */
export function parseSetList(wikitext: string): string[] {
  return templateCalls(wikitext, 'Set list').flatMap(({ lines }) =>
    lines.flatMap((line) => {
      const code = line.split(/;|\/\//)[0]?.trim() ?? '';
      return /^[A-Za-z0-9]+-[A-Za-z0-9]+$/.test(code) ? [code] : [];
    }),
  );
}

export interface CodeChoice {
  printId: string;
  lang: string;
  /** The code in `lang`, null when the lists say the print was never printed in it. */
  code: string | null;
}

/**
 * The verified code of each localization of `prints` (of our set `setCode`) from the set's list
 * pages: the first row of the print's number in the language's best page (`FR` before `FC`). A
 * language's rows with our set code count, or all of them where it has none and the English rows
 * are all ours (early French and Italian sets have their own: `LDC-F065`, `LDI-I065` for
 * `LON-065`). A number in no list, and a print of one language only (`DE001`), are left alone.
 */
export function planCodes(
  setCode: string,
  prints: Pick<PrintArtworks, 'id' | 'number' | 'langs' | 'language'>[],
  pages: { page: GalleryPage; codes: string[] }[],
): CodeChoice[] {
  const all = [...pages]
    .sort((a, b) => pageRank(a.page) - pageRank(b.page))
    .flatMap(({ page, codes }) =>
      codes.map((code) => {
        const parsed = parseSetCode(code);
        return {
          code,
          lang: page.lang,
          ours: parsed.setCode.toLowerCase() === setCode,
          number: numberKey(parsed.number),
        };
      }),
    );
  // Another set code counts only where the English lists are ours alone: a page several sets
  // share (Pharaoh Tour promotional cards, GALLERY_NAMES) would lend us another set's numbers.
  const english = all.filter((r) => r.lang === 'en');
  const alone = english.length > 0 && english.every((r) => r.ours);
  const rows = all.filter(
    (r) => r.ours || (alone && !all.some((o) => o.ours && o.lang === r.lang)),
  );
  return prints.flatMap((p) => {
    const own = rows.filter((r) => r.number === numberKey(p.number));
    if (p.language || !own.length) return [];
    return p.langs.map((lang) => ({
      printId: p.id,
      lang,
      code: own.find((r) => r.lang === lang)?.code ?? null,
    }));
  });
}

/** Writes the verified codes (`set_code_source: 'yugipedia'`); returns the rows changed. */
export async function writeCodes(db: Db, choices: CodeChoice[]): Promise<number> {
  if (!choices.length) return 0;
  const json = JSON.stringify(choices.map((c) => ({ id: c.printId, lang: c.lang, code: c.code })));
  const done = await db.execute(sql`
    update print_localizations l
    set external_ids = (l.external_ids - 'set_code'::text)
      || jsonb_strip_nulls(jsonb_build_object('set_code', v.code, 'set_code_source', 'yugipedia'))
    from jsonb_to_recordset(${json}::jsonb) as v(id uuid, lang text, code text)
    where l.print_id = v.id and l.lang = v.lang
      and (l.external_ids ->> 'set_code' is distinct from v.code
        or l.external_ids ->> 'set_code_source' is distinct from 'yugipedia')`);
  return done.rowCount ?? 0;
}

export type SetListStats = {
  sets: number;
  pages: number;
  /** Localizations whose code the lists decided (confirmed, replaced or dropped). */
  planned: number;
  /** Of them, those dropped: the language has no such print. */
  dropped: number;
  /** Rows whose code changed. */
  written: number;
};

/** Reads one chunk of sets' lists and writes the codes they verify. */
async function importSets(
  deps: ImportDeps,
  planned: PlannedSet[],
  rawKey: string,
  date: string,
  delayMs: number | undefined,
): Promise<SetListStats> {
  const raw: string[] = [];
  const codes = planned.map((s) => s.code);
  const prints = (await deps.withDb((db) => printsOf(db, codes))).filter((p) => !p.language);
  // The lists of the languages the set's prints have, and the English ones; none for a set
  // without a localization to verify.
  const pages = planned.flatMap((s) => {
    const langs = new Set(prints.filter((p) => p.set_code === s.code).flatMap((p) => p.langs));
    if (!langs.size) return [];
    langs.add('en');
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
    planCodes(
      s.code,
      prints.filter((p) => p.set_code === s.code),
      pages
        .filter((p) => s.titles.includes(p.title))
        .map((page) => ({ page, codes: parseSetList(texts.get(page.title) ?? '') })),
    ),
  );
  await deps.raw.put(rawKey, `[${raw.join(',')}]`, { contentType: 'application/json' });
  const written = await deps.withDb(async (db) => {
    const n = await writeCodes(db, choices);
    await markChecked(db, codes, date, SET_LISTS_CHECKED_KEY);
    return n;
  });
  return {
    sets: planned.length,
    pages: texts.size,
    planned: choices.length,
    dropped: choices.filter((c) => !c.code).length,
    written,
  };
}

export interface SetListImportOptions {
  /** `IMPORT_ENV`: raw answers under `raw/<env>/yugipedia/set-lists/<date>/`. */
  env: string;
  date: string;
  /** Wait before every request; `ask`'s CRAWL_DELAY_MS when unset. Tests pass 0. */
  delayMs?: number;
}

/** The set list import as Workflow steps, recorded as `import_runs` source `yugipedia-set-lists`. */
export async function runSetListImport(
  deps: ImportDeps,
  step: StepRunner,
  opts: SetListImportOptions,
) {
  const runId = await step('set lists: start run', () =>
    deps.withDb(async (db) => {
      const [run] = await db
        .insert(importRuns)
        .values({ source: 'yugipedia-set-lists', kind: 'full' })
        .returning({ id: importRuns.id });
      if (!run) throw new Error('import_runs insert returned no row');
      return run.id;
    }),
  );
  const raw = `raw/${opts.env}/yugipedia/set-lists/${opts.date}`;
  const work = `work/${opts.env}/yugipedia-set-lists/${runId}`;
  const n = (i: number) => String(i).padStart(5, '0');
  let result;
  try {
    const chunks = await step('set lists: plan', async () => {
      const bodies: string[] = [];
      const titles = await listSetLists(deps.fetch, bodies, opts.delayMs);
      await deps.raw.put(`${raw}/titles.json`, `[${bodies.join(',')}]`, {
        contentType: 'application/json',
      });
      const planned = await deps.withDb((db) =>
        planSets(db, titles, opts.date, SET_LISTS_CHECKED_KEY),
      );
      const parts = batches(planned, SET_LISTS_PER_STEP);
      for (const [i, part] of parts.entries())
        await deps.raw.put(
          chunkKey(work, i),
          `${part.map((s) => JSON.stringify(s)).join('\n')}\n`,
          { contentType: 'application/x-ndjson' },
        );
      return parts.length;
    });
    const stats: SetListStats = { sets: 0, pages: 0, planned: 0, dropped: 0, written: 0 };
    for (let i = 0; i < chunks; i++) {
      const r = await step(`set lists ${n(i)}`, async () => {
        const planned = (await readChunk(deps.raw, chunkKey(work, i))).map(
          (l) => JSON.parse(l) as PlannedSet,
        );
        return importSets(deps, planned, `${raw}/sets-${n(i)}.json`, opts.date, opts.delayMs);
      });
      for (const k of Object.keys(stats) as (keyof SetListStats)[]) stats[k] += r[k];
    }
    await step('set lists: finish run', () =>
      deps.withDb((db) => finishRun(db, runId, stats, { bump: stats.written > 0 })),
    );
    if (stats.written) await purgeEdgeCache(deps, step, ['catalog'], 'set lists: ');
    result = { runId, stats };
  } catch (err) {
    await step('set lists: fail run', () => deps.withDb((db) => failRun(db, runId, String(err))));
    throw err;
  }
  try {
    await step('set lists: clean up chunks', () => deletePrefix(deps.raw, work));
  } catch (err) {
    log('warn', { message: 'chunk cleanup failed', runId, prefix: work, error: String(err) });
  }
  return result;
}
