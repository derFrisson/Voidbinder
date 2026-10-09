import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
  type WorkflowStepConfig,
} from 'cloudflare:workers';
import { mirrorImages } from '../import/images';
import { runScryfallImport } from '../import/scryfall/pipeline';
import { log } from '../middleware/log';
import { imageMirrorDeps, scryfallImportDeps, withDatabase } from '../platform/cloudflare';

/** Every step: three retries with backoff; the downloads of the bulk files take a few minutes. */
const STEP = {
  retries: { limit: 3, delay: '30 seconds', backoff: 'exponential' },
  timeout: '30 minutes',
} satisfies WorkflowStepConfig;

/** Rows (prints and localizations) the daily delta mirrors per run at most. */
const IMAGE_DELTA_LIMIT = 2000;

/**
 * Binding `SCRYFALL_IMPORT`: the Scryfall import (src/import/scryfall/pipeline.ts) with one
 * durable step per stage and per chunk of 2000 cards. A failed step is retried; completed steps
 * are never repeated within the instance.
 */
export class ScryfallImportWorkflow extends WorkflowEntrypoint<Env> {
  override async run(event: WorkflowEvent<unknown>, step: WorkflowStep) {
    const { runId, stats } = await runScryfallImport(
      scryfallImportDeps(this.env),
      // Every step result is plain JSON (counts, keys); Workflows persists it.
      (name, fn) => step.do(name, STEP, fn as () => Promise<never>),
      {
        env: this.env.IMPORT_ENV,
        date: event.timestamp.toISOString().slice(0, 10),
        languages: this.env.SCRYFALL_LANGUAGES.split(',')
          .map((l) => l.trim())
          .filter(Boolean),
      },
    );
    // Last step (VB-57): mirror the images of the prints this run added; the bulk mirror on the
    // VPS covers the rest. The import is already finished, so a failure here is only logged.
    let images;
    try {
      images = await step.do('mirror images', STEP, () =>
        withDatabase(this.env, (db) =>
          mirrorImages(
            imageMirrorDeps(this.env),
            db,
            { game: 'mtg', sinceRun: runId, limit: IMAGE_DELTA_LIMIT },
            { concurrency: 4, verify: false },
          ),
        ),
      );
    } catch (err) {
      log('warn', { message: 'image mirror failed', runId, error: String(err) });
    }
    return { runId, stats, images };
  }
}
