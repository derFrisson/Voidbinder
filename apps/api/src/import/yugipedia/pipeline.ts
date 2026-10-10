import { and, eq, inArray, sql, type SQLWrapper } from 'drizzle-orm';
import { appMeta, cards, importRuns, printLocalizations, prints } from '../../db/schema';
import { log } from '../../middleware/log';
import type { ImportDeps, StepRunner } from '../scryfall/pipeline';
import { chunkKey, deletePrefix, readChunk } from '../scryfall/source';
import { BATCH_SIZE, excluded, failRun, finishRun, type Db } from '../scryfall/write';
import { batches, purgeEdgeCache } from '../util';
import { ruleCodeIds } from '../ygoprodeck/map';
import {
  ask,
  ASK_BATCH,
  askUrl,
  LANGUAGES,
  parseAnswer,
  pickPages,
  queryableTitle,
  titlesUrl,
  type YugipediaPage,
} from './source';

// The Yugipedia import (VB-93): the names and texts YGOPRODeck lacks. Every Yu-Gi-Oh! card with a
// print that lacks one of the languages (de, fr, it, es, pt) is looked up on Yugipedia, by passcode
// and, for a card without one (Skill Cards, tokens), by its English name as the page title; each
// language the page has becomes a localization of every print of the card, marked with the page in
// `external_ids.yugipedia`. A looked-up card is not asked again for COOL_DOWN_DAYS, found or not. A row another importer wrote is never overwritten, and YGOPRODeck's
// daily German pass overwrites a Yugipedia row once it has the card. The steps have the shape of
// the other importers' (src/import/scryfall/pipeline.ts): each is retried on its own.

export type { ImportDeps, StepRunner };

/** Cards per Workflow step: ten requests of ten passcodes, about 15 s with the crawl delay. */
export const CARDS_PER_STEP = 100;

export interface ImportOptions {
  /** `IMPORT_ENV`: the raw answers go to `raw/<env>/yugipedia/<date>/`, the plan to `work/<env>/…`. */
  env: string;
  /** UTC day of the run. */
  date: string;
  /** Wait before every request; `ask`'s CRAWL_DELAY_MS when unset. Tests pass 0. */
  delayMs?: number;
}

interface PlannedCard {
  key: string;
  name: string;
  /** The card's real passcode when YGOPRODeck keys it by another artwork (see pickPages). */
  aliases: string[] | null;
}

/** Days a looked-up card waits before it is asked again (no page, or a language still missing). */
export const COOL_DOWN_DAYS = 30;
/** `app_meta` key of the map passcode → UTC day the card was last looked up. */
export const CHECKED_KEY = 'yugipedia_checked';
const LANGS = Object.values(LANGUAGES);

/**
 * The cards with a print that lacks one of LANGS, less those looked up within COOL_DOWN_DAYS
 * before `date`.
 */
export async function planCards(db: Db, date: string): Promise<PlannedCard[]> {
  const [meta] = await db
    .select({ value: appMeta.value })
    .from(appMeta)
    .where(eq(appMeta.key, CHECKED_KEY));
  const checked = JSON.parse(meta?.value ?? '{}') as Record<string, string>;
  const since = new Date(Date.parse(date) - COOL_DOWN_DAYS * 86_400_000).toISOString().slice(0, 10);
  const candidates = await db
    .select({
      key: cards.oracleKey,
      name: cards.name,
      aliases: sql<string[] | null>`(
        select array_agg(distinct l.external_ids->>'ygoprodeck') from ${prints} p
        join ${printLocalizations} l on l.print_id = p.id
        where p.card_id = "cards"."id" and l.external_ids ? 'ygoprodeck')`,
      // ↑ spelled out: drizzle writes a select field's column unqualified, which p.id would shadow
    })
    .from(cards)
    .where(
      and(
        eq(cards.gameId, 'yugioh'),
        sql`exists (select 1 from ${prints} p where p.card_id = ${cards.id} and (
          select count(*) from ${printLocalizations}
          where ${printLocalizations.printId} = p.id and ${inArray(printLocalizations.lang, LANGS)}
        ) < ${LANGS.length})`,
      ),
    )
    .orderBy(cards.oracleKey);
  return candidates.filter((c) => (checked[c.key] ?? '') <= since);
}

/** Marks the cards (or, with `metaKey`, the gallery sets) as looked up on `date` (one atomic merge into the `app_meta` map). */
export async function markChecked(db: Db, keys: string[], date: string, metaKey = CHECKED_KEY) {
  if (!keys.length) return;
  // ponytail: one JSON map in app_meta (≈ 25 bytes per card, ~14k cards); a table if it grows.
  await db
    .insert(appMeta)
    .values({
      key: metaKey,
      value: JSON.stringify(Object.fromEntries(keys.map((k) => [k, date]))),
    })
    .onConflictDoUpdate({
      target: appMeta.key,
      set: {
        value: sql`(${appMeta.value}::jsonb || excluded.value::jsonb)::text`,
        updatedAt: sql`now()`,
      },
    });
}

/** `external_ids` key of a print's own scan (VB-106, galleries.ts), kept by the other importers. */
export const ARTWORK = 'artwork';

/** A placeholder rarity's gallery row (galleries.ts `resolveRarities`, VB-117): `{ rarity, alt }`. */
export const GALLERY_RARITY = 'gallery_rarity';

/**
 * `excluded.external_ids` plus the row's own `artwork` and `gallery_rarity`: an upsert's `set`
 * that keeps what the galleries wrote.
 */
export const keepArtwork = (column: SQLWrapper) =>
  sql`excluded.external_ids || jsonb_strip_nulls(jsonb_build_object(${ARTWORK}::text, ${column} -> ${ARTWORK}::text,
    ${GALLERY_RARITY}::text, ${column} -> ${GALLERY_RARITY}::text))`;

/**
 * A localization's `excluded.external_ids` with what Yugipedia owns on the row kept: the scan
 * (`artwork`) and a code the set lists verified (`set_code_source: 'yugipedia'`, set-lists.ts,
 * also when they dropped it), which the rule's code (`ruleCode`) must not replace. The upsert's
 * `set`, and its setWhere's comparison with the row.
 */
export const keepYugipedia = (column: SQLWrapper) => sql`(case
    when ${column} ->> 'set_code_source' = 'yugipedia'
      then (excluded.external_ids - 'set_code' - 'set_code_source') || jsonb_strip_nulls(
        jsonb_build_object('set_code', ${column} -> 'set_code', 'set_code_source', 'yugipedia'))
    else excluded.external_ids end)
  || jsonb_strip_nulls(jsonb_build_object(${ARTWORK}::text, ${column} -> ${ARTWORK}::text))`;

/**
 * The pages' localizations for every print of their cards. Inserts, or updates a row this importer
 * wrote when the page changed; returns the rows written.
 */
export async function writeLocalizations(
  db: Db,
  pages: Map<string, YugipediaPage>,
): Promise<number> {
  if (!pages.size) return 0;
  const owned = await db
    .select({
      id: prints.id,
      key: cards.oracleKey,
      code: sql<string | null>`${prints.externalIds} ->> 'set_code'`,
    })
    .from(prints)
    .innerJoin(cards, eq(cards.id, prints.cardId))
    .where(and(eq(cards.gameId, 'yugioh'), inArray(cards.oracleKey, [...pages.keys()])));
  const rows = owned.flatMap((p) => {
    const page = pages.get(p.key);
    return (page?.localizations ?? []).map((l) => ({
      printId: p.id,
      lang: l.lang,
      name: l.name,
      text: l.text,
      externalIds: { yugipedia: page?.title, ...ruleCodeIds(p.code, l.lang) },
    }));
  });
  let written = 0;
  for (const batch of batches(rows, BATCH_SIZE)) {
    const returned = await db
      .insert(printLocalizations)
      .values(batch)
      .onConflictDoUpdate({
        target: [printLocalizations.printId, printLocalizations.lang],
        set: {
          name: excluded('name'),
          text: excluded('text'),
          externalIds: keepYugipedia(printLocalizations.externalIds),
        },
        setWhere: sql`${printLocalizations.externalIds} ? 'yugipedia'
          and (${printLocalizations.name}, ${printLocalizations.text}, ${printLocalizations.externalIds})
          is distinct from (excluded.name, excluded.text, ${keepYugipedia(printLocalizations.externalIds)})`,
      })
      .returning({ printId: printLocalizations.printId });
    written += returned.length;
  }
  return written;
}

interface ChunkStats {
  /** Cards a page was found for. */
  found: number;
  /** Cards Yugipedia has no page with a translation for. */
  missing: number;
  /** Localization rows inserted or changed. */
  written: number;
}

/** Looks up one chunk of planned cards and writes what it finds. */
async function importChunk(
  deps: ImportDeps,
  planned: PlannedCard[],
  rawKey: string,
  date: string,
  delayMs: number | undefined,
): Promise<ChunkStats> {
  const bodies: string[] = [];
  const found = new Map<string, YugipediaPage>();
  const lookup = async (cardsOf: PlannedCard[], by: 'passcode' | 'title') => {
    for (const batch of batches(cardsOf, ASK_BATCH)) {
      const url =
        by === 'passcode' ? askUrl(batch.map((c) => c.key)) : titlesUrl(batch.map((c) => c.name));
      const body = await ask(deps.fetch, url, delayMs);
      bodies.push(body);
      for (const [key, page] of pickPages(parseAnswer(JSON.parse(body)), batch, by))
        found.set(key, page);
    }
  };
  await lookup(planned, 'passcode');
  await lookup(
    planned.filter((c) => !found.has(c.key) && queryableTitle(c.name)),
    'title',
  );
  await deps.raw.put(rawKey, `[${bodies.join(',')}]`, { contentType: 'application/json' });
  const written = await deps.withDb(async (db) => {
    const n = await writeLocalizations(db, found);
    await markChecked(
      db,
      planned.map((c) => c.key),
      date,
    );
    return n;
  });
  return { found: found.size, missing: planned.length - found.size, written };
}

export async function runYugipediaImport(deps: ImportDeps, step: StepRunner, opts: ImportOptions) {
  const runId = await step('start run', () =>
    deps.withDb(async (db) => {
      const [run] = await db
        .insert(importRuns)
        .values({ source: 'yugipedia', kind: 'full' })
        .returning({ id: importRuns.id });
      if (!run) throw new Error('import_runs insert returned no row');
      return run.id;
    }),
  );
  const raw = `raw/${opts.env}/yugipedia/${opts.date}`;
  const work = `work/${opts.env}/yugipedia/${runId}`;
  const n = (i: number) => String(i).padStart(5, '0');
  let result;
  try {
    // The plan goes to R2 in chunks, so every step reads its own and a retry reads the same.
    const chunks = await step('plan', async () => {
      const planned = await deps.withDb((db) => planCards(db, opts.date));
      const parts = batches(planned, CARDS_PER_STEP);
      for (const [i, part] of parts.entries())
        await deps.raw.put(
          chunkKey(work, i),
          `${part.map((c) => JSON.stringify(c)).join('\n')}\n`,
          { contentType: 'application/x-ndjson' },
        );
      return parts.length;
    });
    const stats = { planned: 0, found: 0, missing: 0, written: 0 };
    for (let i = 0; i < chunks; i++) {
      const r = await step(`cards ${n(i)}`, async () => {
        const planned = (await readChunk(deps.raw, chunkKey(work, i))).map(
          (l) => JSON.parse(l) as PlannedCard,
        );
        return {
          planned: planned.length,
          ...(await importChunk(
            deps,
            planned,
            `${raw}/cards-${n(i)}.json`,
            opts.date,
            opts.delayMs,
          )),
        };
      });
      for (const k of Object.keys(stats) as (keyof typeof stats)[]) stats[k] += r[k];
    }
    // Nothing written, nothing for the apps to fetch: catalog_version stays.
    await step('finish run', () =>
      deps.withDb((db) => finishRun(db, runId, stats, { bump: stats.written > 0 })),
    );
    if (stats.written) await purgeEdgeCache(deps, step, ['catalog']);
    result = { runId, stats };
  } catch (err) {
    await step('fail run', () => deps.withDb((db) => failRun(db, runId, String(err))));
    throw err;
  }
  try {
    await step('clean up chunks', () => deletePrefix(deps.raw, work));
  } catch (err) {
    log('warn', { message: 'chunk cleanup failed', runId, prefix: work, error: String(err) });
  }
  return result;
}
