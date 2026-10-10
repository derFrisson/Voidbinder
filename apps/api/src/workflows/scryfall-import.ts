import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
  type WorkflowStepConfig,
} from 'cloudflare:workers';
import { runScryfallPrices } from '../import/prices/scryfall';
import { runScryfallImport, type StepRunner } from '../import/scryfall/pipeline';
import { log } from '../middleware/log';
import { scryfallImportDeps } from '../platform/cloudflare';
import { mirrorStepFor } from './mirror-images';

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
    const deps = scryfallImportDeps(this.env);
    // Every step result is plain JSON (counts, keys); Workflows persists it.
    const run: StepRunner = (name, fn) => step.do(name, STEP, fn as () => Promise<never>);
    const date = event.timestamp.toISOString().slice(0, 10);
    const { runId, stats } = await runScryfallImport(deps, run, {
      env: this.env.IMPORT_ENV,
      date,
      languages: this.env.SCRYFALL_LANGUAGES.split(',')
        .map((l) => l.trim())
        .filter(Boolean),
    });
    // VB-30: the day's Cardmarket EUR and TCGplayer USD prices from the dump just stored. The
    // catalog is imported either way, so a failure is logged and the image step still runs.
    const prices = await runScryfallPrices(deps, run, {
      env: this.env.IMPORT_ENV,
      date,
      observedAt: event.timestamp.toISOString(),
    }).catch((err: unknown) => {
      log('warn', { message: 'Scryfall prices failed', error: String(err) });
      return undefined;
    });
    // Last step (VB-57): the oldest pending Magic images, at most 2000.
    const images = await mirrorStepFor('mtg')(this.env, step);
    return { runId, stats, prices, images };
  }
}
