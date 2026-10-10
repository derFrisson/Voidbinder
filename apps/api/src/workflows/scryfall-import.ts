import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
  type WorkflowStepConfig,
} from 'cloudflare:workers';
import { runScryfallImport, type StepRunner } from '../import/scryfall/pipeline';
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
    const { runId, stats, prices } = await runScryfallImport(deps, run, {
      env: this.env.IMPORT_ENV,
      date: event.timestamp.toISOString().slice(0, 10),
      languages: this.env.SCRYFALL_LANGUAGES.split(',')
        .map((l) => l.trim())
        .filter(Boolean),
      // VB-30: the dump's Cardmarket EUR and TCGplayer USD prices, one step per chunk.
      pricesObservedAt: event.timestamp.toISOString(),
    });
    // Last step (VB-57): the oldest pending Magic images, at most 2000.
    const images = await mirrorStepFor('mtg')(this.env, step);
    return { runId, stats, prices, images };
  }
}
