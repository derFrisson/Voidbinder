import { mirrorStepFor } from './mirror-images';
import { refreshSearchIndexStep } from './search-index-refresh';
import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
  type WorkflowStepConfig,
} from 'cloudflare:workers';
import { runPokemontcgImport } from '../import/pokemontcg/pipeline';
import { runTcgdexImport, type ImportOptions } from '../import/tcgdex/pipeline';
import { log } from '../middleware/log';
import { pokemontcgImportDeps, tcgdexImportDeps } from '../platform/cloudflare';
import { edgeCacheDeps } from '../platform/cloudflare/cache';

/** Every step: three retries with backoff; a chunk of cards takes about half a minute. */
const STEP = {
  retries: { limit: 3, delay: '30 seconds', backoff: 'exponential' },
  timeout: '15 minutes',
} satisfies WorkflowStepConfig;

/** `en` creates the cards, `de` adds the German names, texts and images. */
const LANGUAGES = ['en', 'de'];

export interface TcgdexImportParams {
  /** Default `incremental`; `full` refetches every set. */
  mode?: ImportOptions['mode'];
  /** Run the pokemontcg.io pictures (VB-118) whatever the day; otherwise Mondays (UTC) only. */
  pokemontcg?: boolean;
}

/**
 * Binding `TCGDEX_IMPORT`: the TCGdex import (src/import/tcgdex/pipeline.ts) with one durable step
 * per batch of sets and per chunk of 100 cards. A failed step is retried; completed steps are never
 * repeated within the instance. On Mondays (UTC), or with `pokemontcg`, the pokemontcg.io pictures
 * for the prints TCGdex has none for follow (VB-118, weekly), before the image mirror copies them.
 */
export class TcgdexImportWorkflow extends WorkflowEntrypoint<Env, TcgdexImportParams> {
  override async run(event: WorkflowEvent<TcgdexImportParams>, step: WorkflowStep) {
    // Every step result is plain JSON (counts, ids); Workflows persists it.
    const runner = <T>(name: string, fn: () => Promise<T>) =>
      step.do(name, STEP, fn as () => Promise<never>) as Promise<T>;
    const date = event.timestamp.toISOString().slice(0, 10);
    const { runId, stats } = await runTcgdexImport(
      { ...tcgdexImportDeps(this.env), ...edgeCacheDeps(step) },
      runner,
      {
        env: this.env.IMPORT_ENV,
        date,
        languages: LANGUAGES,
        mode: event.payload.mode ?? 'incremental',
      },
    );
    // A failure is recorded in its own import_runs row (the health reports it); the mirror and the
    // search index still run.
    const pokemontcg =
      event.payload.pokemontcg || event.timestamp.getUTCDay() === 1
        ? await runPokemontcgImport(pokemontcgImportDeps(this.env), runner, {
            env: this.env.IMPORT_ENV,
            date,
          }).catch((err: unknown) => {
            log('warn', { message: 'pokemontcg import failed', error: String(err) });
            return null;
          })
        : null;
    // VB-57: the oldest pending Pokémon images, at most 2000.
    const images = await mirrorStepFor('pokemon')(this.env, step);
    // Then the search index (VB-98) copies what the import and the mirror changed.
    const searchIndex = await refreshSearchIndexStep(this.env, step);
    return { runId, stats, pokemontcg, images, searchIndex };
  }
}
