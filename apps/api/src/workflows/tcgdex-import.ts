import { mirrorStepFor } from './mirror-images';
import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
  type WorkflowStepConfig,
} from 'cloudflare:workers';
import { runTcgdexImport, type ImportOptions } from '../import/tcgdex/pipeline';
import { tcgdexImportDeps } from '../platform/cloudflare';
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
}

/**
 * Binding `TCGDEX_IMPORT`: the TCGdex import (src/import/tcgdex/pipeline.ts) with one durable step
 * per batch of sets and per chunk of 100 cards. A failed step is retried; completed steps are never
 * repeated within the instance.
 */
export class TcgdexImportWorkflow extends WorkflowEntrypoint<Env, TcgdexImportParams> {
  override async run(event: WorkflowEvent<TcgdexImportParams>, step: WorkflowStep) {
    const { runId, stats } = await runTcgdexImport(
      { ...tcgdexImportDeps(this.env), ...edgeCacheDeps(step) },
      // Every step result is plain JSON (counts, ids); Workflows persists it.
      (name, fn) => step.do(name, STEP, fn as () => Promise<never>),
      {
        env: this.env.IMPORT_ENV,
        date: event.timestamp.toISOString().slice(0, 10),
        languages: LANGUAGES,
        mode: event.payload.mode ?? 'incremental',
      },
    );
    // Last step (VB-57): the oldest pending Pokémon images, at most 2000.
    const images = await mirrorStepFor('pokemon')(this.env, step);
    return { runId, stats, images };
  }
}
