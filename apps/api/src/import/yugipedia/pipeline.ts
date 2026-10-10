import { and, eq, inArray, sql } from 'drizzle-orm';
import { cards, importRuns, printLocalizations, prints } from '../../db/schema';
import { log } from '../../middleware/log';
import type { ImportDeps, StepRunner } from '../scryfall/pipeline';
import { chunkKey, deletePrefix, readChunk } from '../scryfall/source';
import { BATCH_SIZE, excluded, failRun, finishRun, type Db } from '../scryfall/write';
import { batches, purgeEdgeCache } from '../util';
import {
  ask,
  ASK_BATCH,
  askUrl,
  parseAnswer,
  pickPages,
  queryableTitle,
  titlesUrl,
  type YugipediaPage,
} from './source';

// The Yugipedia import (VB-93): the names and texts YGOPRODeck lacks. Every Yu-Gi-Oh! card with a
// print that has no German localization is looked up on Yugipedia, by passcode and, for a card
// without one (Skill Cards, tokens), by its English name as the page title; each language the page
// has (de, fr, it, es, pt) becomes a localization of every print of the card, marked with the page
// in `external_ids.yugipedia`. A row another importer wrote is never overwritten, and YGOPRODeck's
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
  /** Wait before every request; robots.txt asks for one second. Tests pass 0. */
  delayMs?: number;
}

interface PlannedCard {
  key: string;
  name: string;
}

/** The cards with a print that has no `de` localization. */
export async function planCards(db: Db): Promise<PlannedCard[]> {
  return db
    .select({ key: cards.oracleKey, name: cards.name })
    .from(cards)
    .where(
      and(
        eq(cards.gameId, 'yugioh'),
        sql`exists (select 1 from ${prints} p where p.card_id = ${cards.id} and not exists (
          select 1 from ${printLocalizations} l where l.print_id = p.id and l.lang = 'de'))`,
      ),
    )
    .orderBy(cards.oracleKey);
}

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
    .select({ id: prints.id, key: cards.oracleKey })
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
      externalIds: { yugipedia: page?.title },
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
          externalIds: excluded('external_ids'),
        },
        setWhere: sql`${printLocalizations.externalIds} ? 'yugipedia'
          and (${printLocalizations.name}, ${printLocalizations.text}, ${printLocalizations.externalIds})
          is distinct from (excluded.name, excluded.text, excluded.external_ids)`,
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
  delayMs: number,
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
  const written = await deps.withDb((db) => writeLocalizations(db, found));
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
      const planned = await deps.withDb(planCards);
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
          ...(await importChunk(deps, planned, `${raw}/cards-${n(i)}.json`, opts.delayMs ?? 1000)),
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
