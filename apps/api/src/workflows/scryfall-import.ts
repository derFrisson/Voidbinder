import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
  type WorkflowStepConfig,
} from 'cloudflare:workers';
import { runScryfallImport } from '../import/scryfall/pipeline';
import { withDatabase } from '../platform/cloudflare';
import { R2BlobStore } from '../platform/cloudflare/r2-blob-store';

/** Every step: three retries with backoff; the downloads of the bulk files take a few minutes. */
const STEP = {
  retries: { limit: 3, delay: '30 seconds', backoff: 'exponential' },
  timeout: '30 minutes',
} satisfies WorkflowStepConfig;

/**
 * Binding `SCRYFALL_IMPORT`: the Scryfall import (src/import/scryfall/pipeline.ts) with one
 * durable step per stage and per chunk of 2000 cards. A failed step is retried; completed steps
 * are never repeated within the instance.
 */
export class ScryfallImportWorkflow extends WorkflowEntrypoint<Env> {
  override async run(event: WorkflowEvent<unknown>, step: WorkflowStep) {
    const { runId, stats } = await runScryfallImport(
      {
        fetch: (input, init) => fetch(input, init),
        blobs: new R2BlobStore(this.env.CATALOG),
        withDb: (fn) => withDatabase(this.env, fn),
      },
      // Every step result is plain JSON (counts, keys); Workflows persists it.
      (name, fn) => step.do(name, STEP, fn as () => Promise<never>),
      {
        date: event.timestamp.toISOString().slice(0, 10),
        languages: this.env.SCRYFALL_LANGUAGES.split(',')
          .map((l) => l.trim())
          .filter(Boolean),
      },
    );
    return { runId, stats };
  }
}
