import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
  type WorkflowStepConfig,
} from 'cloudflare:workers';
import { runYugipediaImport } from '../import/yugipedia/pipeline';
import { scryfallImportDeps } from '../platform/cloudflare';
import { edgeCacheDeps } from '../platform/cloudflare/cache';
import { refreshSearchIndexStep } from './search-index-refresh';

/** Every step: three retries with backoff; a step is about twenty requests a second apart. */
const STEP = {
  retries: { limit: 3, delay: '30 seconds', backoff: 'exponential' },
  timeout: '10 minutes',
} satisfies WorkflowStepConfig;

/**
 * Binding `YUGIPEDIA_IMPORT`: the Yugipedia localization import (src/import/yugipedia/pipeline.ts)
 * with one durable step per 100 cards. A failed step is retried; completed steps are never
 * repeated within the instance.
 */
export class YugipediaImportWorkflow extends WorkflowEntrypoint<Env> {
  override async run(event: WorkflowEvent<unknown>, step: WorkflowStep) {
    const result = await runYugipediaImport(
      { ...scryfallImportDeps(this.env), ...edgeCacheDeps(step) },
      // Every step result is plain JSON (counts); Workflows persists it.
      (name, fn) => step.do(name, STEP, fn as () => Promise<never>),
      { env: this.env.IMPORT_ENV, date: event.timestamp.toISOString().slice(0, 10) },
    );
    // The names this run wrote reach the D1 typeahead (VB-98) now, not with the next daily import.
    const searchIndex = await refreshSearchIndexStep(this.env, step);
    return { ...result, searchIndex };
  }
}
