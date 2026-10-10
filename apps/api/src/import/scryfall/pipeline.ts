import type { BlobStore } from '@voidbinder/core';
import { log } from '../../middleware/log';
import { runScryfallPrices } from '../prices/scryfall';
import { purgeEdgeCache, type EdgeCacheDeps } from '../util';
import {
  bulkFiles,
  chunkKey,
  deletePrefix,
  download,
  fetchSets,
  langFilter,
  readChunk,
  split,
  type Fetch,
} from './source';
import {
  failRun,
  finishRun,
  importCardLines,
  importLocalizationLines,
  startRun,
  upsertSets,
  type CardChunkStats,
  type Db,
  type LocalizationChunkStats,
  type WriteStats,
} from './write';

// The Scryfall import as a sequence of named, retryable steps. The Workflow
// (src/workflows/scryfall-import.ts) runs each through `step.do`, so a failed run resumes at the
// failed step; tests and local runs pass a runner that just calls the function.

/** Objects per chunk and per Workflow step (~10 MB of JSON, four transactions of 500). */
export const CHUNK_LINES = 2000;

export interface ImportDeps extends EdgeCacheDeps {
  fetch: Fetch;
  /** The private `RAW` bucket: the raw dumps (`raw/…`) and a run's chunks (`work/…`). */
  raw: BlobStore;
  /** Opens a connection for one step and closes it afterwards. */
  withDb<T>(fn: (db: Db) => Promise<T>): Promise<T>;
}

/** Runs one named step; its result must be JSON-serializable (it is persisted by Workflows). */
export type StepRunner = <T>(name: string, fn: () => Promise<T>) => Promise<T>;

export interface ImportOptions {
  /** `IMPORT_ENV` (`local`, `dev`, `prod`): every R2 key starts with `raw/<env>/` or `work/<env>/`. */
  env: string;
  /** UTC day of the run: the raw dumps go to `raw/<env>/scryfall/<date>/`. */
  date: string;
  /** Localizations to import; `en` always comes from default_cards, the rest from all_cards. */
  languages: string[];
  /** VB-30: when set, the dump's prices as observed then (src/import/prices/scryfall.ts). */
  pricesObservedAt?: string;
}

export interface ChunkStep {
  name: string;
  kind: 'cards' | 'localizations';
  key: string;
}

/** One step per chunk: the cards first (they create the prints), then the other languages. */
export function planSteps(prefix: string, cardChunks: number, localizationChunks: number) {
  const steps: ChunkStep[] = [];
  const n = (i: number) => String(i).padStart(5, '0');
  for (let i = 0; i < cardChunks; i++)
    steps.push({
      name: `cards ${n(i)}`,
      kind: 'cards',
      key: chunkKey(`${prefix}/default_cards`, i),
    });
  for (let i = 0; i < localizationChunks; i++) {
    const key = chunkKey(`${prefix}/all_cards`, i);
    steps.push({ name: `localizations ${n(i)}`, kind: 'localizations', key });
  }
  return steps;
}

const add = (a: WriteStats, b: WriteStats): WriteStats => ({
  inserted: a.inserted + b.inserted,
  updated: a.updated + b.updated,
  unchanged: a.unchanged + b.unchanged,
});

export async function runScryfallImport(deps: ImportDeps, step: StepRunner, opts: ImportOptions) {
  const runId = await step('start run', () => deps.withDb((db) => startRun(db, 'full')));
  const raw = `raw/${opts.env}/scryfall/${opts.date}`;
  const work = `work/${opts.env}/scryfall/${runId}`;
  let result;
  try {
    const files = await step('bulk index', () => bulkFiles(deps.fetch));
    const others = opts.languages.filter((l) => l !== 'en');

    await step('download default_cards', () =>
      download(deps.fetch, deps.raw, files.default_cards, `${raw}/default_cards.jsonl.gz`),
    );
    const cardSplit = await step('split default_cards', () =>
      split(deps.raw, `${raw}/default_cards.jsonl.gz`, `${work}/default_cards`, CHUNK_LINES),
    );
    let localizationSplit = { chunks: 0, lines: 0 };
    if (others.length) {
      await step('download all_cards', () =>
        download(deps.fetch, deps.raw, files.all_cards, `${raw}/all_cards.jsonl.gz`),
      );
      localizationSplit = await step('split all_cards', () =>
        split(
          deps.raw,
          `${raw}/all_cards.jsonl.gz`,
          `${work}/all_cards`,
          CHUNK_LINES,
          langFilter(others),
        ),
      );
    }

    const sets = await step('sets', async () => {
      const source = await fetchSets(deps.fetch, deps.raw, `${raw}/sets.json`);
      return deps.withDb((db) => upsertSets(db, source));
    });

    const zero = { inserted: 0, updated: 0, unchanged: 0 };
    const cards: CardChunkStats = {
      cards: zero,
      prints: zero,
      localizations: 0,
      skipped: { layout: 0, digital: 0, noSet: 0 },
    };
    const localizations: LocalizationChunkStats = { written: 0, noPrint: 0 };
    for (const s of planSteps(work, cardSplit.chunks, localizationSplit.chunks)) {
      if (s.kind === 'cards') {
        const r = await step(s.name, async () =>
          deps.withDb(async (db) => importCardLines(db, await readChunk(deps.raw, s.key))),
        );
        cards.cards = add(cards.cards, r.cards);
        cards.prints = add(cards.prints, r.prints);
        cards.localizations += r.localizations;
        for (const k of ['layout', 'digital', 'noSet'] as const) cards.skipped[k] += r.skipped[k];
      } else {
        const r = await step(s.name, async () =>
          deps.withDb(async (db) => importLocalizationLines(db, await readChunk(deps.raw, s.key))),
        );
        localizations.written += r.written;
        localizations.noPrint += r.noPrint;
      }
    }

    const stats = {
      languages: opts.languages,
      lines: { default_cards: cardSplit.lines, all_cards: localizationSplit.lines },
      sets,
      ...cards,
      otherLanguages: localizations,
    };
    await step('finish run', () => deps.withDb((db) => finishRun(db, runId, stats)));
    await purgeEdgeCache(deps, step, ['catalog', 'game:mtg']);
    result = { runId, stats, chunks: cardSplit.chunks };
  } catch (err) {
    await step('fail run', () => deps.withDb((db) => failRun(db, runId, String(err))));
    throw err;
  }
  // VB-30: the prices of the same chunks, before they are deleted. The catalog is imported
  // either way, so a failure is logged and leaves that run ok.
  let prices;
  if (opts.pricesObservedAt) {
    const observedAt = opts.pricesObservedAt;
    prices = await runScryfallPrices(deps, step, { work, chunks: result.chunks, observedAt }).catch(
      (err: unknown) => {
        log('warn', { message: 'Scryfall prices failed', runId, error: String(err) });
        return undefined;
      },
    );
  }
  // The run is finished: a failed cleanup leaves chunks behind, never a failed run.
  try {
    await step('clean up chunks', () => deletePrefix(deps.raw, work));
  } catch (err) {
    log('warn', { message: 'chunk cleanup failed', runId, prefix: work, error: String(err) });
  }
  return { runId: result.runId, stats: result.stats, prices };
}
