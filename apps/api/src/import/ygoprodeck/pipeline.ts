import { log } from '../../middleware/log';
import type { ImportDeps, StepRunner } from '../scryfall/pipeline';
import { purgeEdgeCache } from '../util';
import {
  chunkKey,
  deletePrefix,
  downloadCardinfo,
  fetchSets,
  readChunk,
  splitCardinfo,
} from './source';
import {
  CONFLICTS_KEPT,
  failRun,
  finishRun,
  importCardLines,
  importLocalizationLines,
  startRun,
  upsertSets,
  type CardChunkStats,
  type LocalizationChunkStats,
  type WriteStats,
} from './write';

// The YGOPRODeck import as a sequence of named, retryable steps, the shape of the Scryfall one
// (src/import/scryfall/pipeline.ts): the Workflow runs each through `step.do`; tests and local
// runs pass a runner that just calls the function.

export type { ImportDeps, StepRunner };

/** Cards per chunk and per Workflow step (~1.7 MB of JSON, two transactions of 500 cards). */
export const CHUNK_LINES = 1000;

export interface ImportOptions {
  /** `IMPORT_ENV` (`local`, `dev`, `prod`): every R2 key starts with `raw/<env>/` or `work/<env>/`. */
  env: string;
  /** UTC day of the run: the raw dumps go to `raw/<env>/ygoprodeck/<date>/`. */
  date: string;
  /** Languages to import: `en` is the catalog itself, the others (`de`, `fr`, `it`, `pt`) localize it. */
  languages: string[];
}

export interface ChunkStep {
  name: string;
  /** `en` writes cards, any other language writes localizations. */
  lang: string;
  key: string;
}

/** One step per chunk: the English cards first (they create the prints), then each language. */
export function planSteps(prefix: string, chunks: Record<string, number>) {
  const steps: ChunkStep[] = [];
  const n = (i: number) => String(i).padStart(5, '0');
  const langs = Object.keys(chunks).sort((a, b) =>
    a === 'en' ? -1 : b === 'en' ? 1 : a < b ? -1 : 1,
  );
  for (const lang of langs)
    for (let i = 0; i < (chunks[lang] ?? 0); i++)
      steps.push({
        name: `${lang === 'en' ? 'cards' : `localizations ${lang}`} ${n(i)}`,
        lang,
        key: chunkKey(`${prefix}/cardinfo_${lang}`, i),
      });
  return steps;
}

const add = (a: WriteStats, b: WriteStats): WriteStats => ({
  inserted: a.inserted + b.inserted,
  updated: a.updated + b.updated,
  unchanged: a.unchanged + b.unchanged,
});

export async function runYgoprodeckImport(deps: ImportDeps, step: StepRunner, opts: ImportOptions) {
  const runId = await step('start run', () => deps.withDb((db) => startRun(db)));
  const raw = `raw/${opts.env}/ygoprodeck/${opts.date}`;
  const work = `work/${opts.env}/ygoprodeck/${runId}`;
  // English is the catalog; asking for it twice would write the same rows twice.
  const languages = ['en', ...opts.languages.filter((l) => l !== 'en')];
  let result;
  try {
    const chunks: Record<string, number> = {};
    const lines: Record<string, number> = {};
    for (const lang of languages) {
      await step(`download ${lang}`, () =>
        downloadCardinfo(deps.fetch, deps.raw, lang, `${raw}/cardinfo_${lang}.json.gz`),
      );
      const split = await step(`split ${lang}`, () =>
        splitCardinfo(
          deps.raw,
          `${raw}/cardinfo_${lang}.json.gz`,
          `${work}/cardinfo_${lang}`,
          CHUNK_LINES,
        ),
      );
      chunks[lang] = split.chunks;
      lines[lang] = split.lines;
    }

    const sets = await step('sets', async () => {
      const source = await fetchSets(deps.fetch, deps.raw, `${raw}/cardsets.json`);
      return deps.withDb((db) => upsertSets(db, source));
    });

    const zero = { inserted: 0, updated: 0, unchanged: 0 };
    const cards: CardChunkStats = {
      cards: zero,
      prints: zero,
      localizations: 0,
      setsCreated: 0,
      skipped: { noSets: 0, codeConflicts: 0 },
      codeConflicts: [],
    };
    const localizations: Record<string, LocalizationChunkStats> = {};
    for (const s of planSteps(work, chunks)) {
      if (s.lang === 'en') {
        const r = await step(s.name, async () =>
          deps.withDb(async (db) => importCardLines(db, await readChunk(deps.raw, s.key))),
        );
        cards.cards = add(cards.cards, r.cards);
        cards.prints = add(cards.prints, r.prints);
        cards.localizations += r.localizations;
        cards.setsCreated += r.setsCreated;
        cards.skipped.noSets += r.skipped.noSets;
        cards.skipped.codeConflicts += r.skipped.codeConflicts;
        cards.codeConflicts = [...cards.codeConflicts, ...r.codeConflicts].slice(0, CONFLICTS_KEPT);
      } else {
        const r = await step(s.name, async () =>
          deps.withDb(async (db) =>
            importLocalizationLines(db, await readChunk(deps.raw, s.key), s.lang),
          ),
        );
        const total = (localizations[s.lang] ??= { written: 0, noCard: 0 });
        total.written += r.written;
        total.noCard += r.noCard;
      }
    }

    const stats = { languages, lines, sets, ...cards, otherLanguages: localizations };
    await step('finish run', () => deps.withDb((db) => finishRun(db, runId, stats)));
    await purgeEdgeCache(deps, step, ['catalog', 'game:yugioh']);
    result = { runId, stats };
  } catch (err) {
    await step('fail run', () => deps.withDb((db) => failRun(db, runId, String(err))));
    throw err;
  }
  // The run is finished: a failed cleanup leaves chunks behind, never a failed run.
  try {
    await step('clean up chunks', () => deletePrefix(deps.raw, work));
  } catch (err) {
    log('warn', { message: 'chunk cleanup failed', runId, prefix: work, error: String(err) });
  }
  return result;
}
