import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
  type WorkflowStepConfig,
} from 'cloudflare:workers';
import { runYgoprodeckImport } from '../import/ygoprodeck/pipeline';
import { ygoprodeckImportDeps } from '../platform/cloudflare';
import { edgeCacheDeps } from '../platform/cloudflare/cache';
import { mirrorStepFor } from './mirror-images';
import { refreshSearchIndexStep } from './search-index-refresh';

/** Every step: three retries with backoff; a download is one request of a few MB. */
const STEP = {
  retries: { limit: 3, delay: '30 seconds', backoff: 'exponential' },
  timeout: '30 minutes',
} satisfies WorkflowStepConfig;

/** Languages besides English the catalog is localized in (the API also has `fr`, `it`, `pt`). */
const LANGUAGES = ['en', 'de'];

/**
 * Binding `YGOPRODECK_IMPORT`: the YGOPRODeck import (src/import/ygoprodeck/pipeline.ts) with one
 * durable step per stage and per chunk of 1000 cards. A failed step is retried; completed steps
 * are never repeated within the instance.
 */
export class YgoprodeckImportWorkflow extends WorkflowEntrypoint<Env> {
  override async run(event: WorkflowEvent<unknown>, step: WorkflowStep) {
    const { runId, stats } = await runYgoprodeckImport(
      { ...ygoprodeckImportDeps(this.env), ...edgeCacheDeps(step) },
      // Every step result is plain JSON (counts, keys); Workflows persists it.
      (name, fn) => step.do(name, STEP, fn as () => Promise<never>),
      {
        env: this.env.IMPORT_ENV,
        date: event.timestamp.toISOString().slice(0, 10),
        languages: LANGUAGES,
      },
    );
    // VB-57: the oldest pending Yu-Gi-Oh! images, at most 500.
    const images = await mirrorStepFor('yugioh')(this.env, step);
    // Then the search index (VB-98) copies what the import and the mirror changed.
    const searchIndex = await refreshSearchIndexStep(this.env, step);
    return { runId, stats, images, searchIndex };
  }
}
