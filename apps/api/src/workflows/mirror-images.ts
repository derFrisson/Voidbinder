import type { WorkflowStep, WorkflowStepConfig } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';
import { mirrorImages, MirrorBusy, SourceRateLimited } from '../import/images';
import { log } from '../middleware/log';
import { imageMirrorDeps, withDatabase } from '../platform/cloudflare';

/**
 * Rows (prints and localizations) and parallel downloads of one daily delta per game. Yu-Gi-Oh!
 * stays low: YGOPRODeck blocks an IP for an hour after a breach of its 20/s.
 */
const DELTA = {
  mtg: { limit: 2000, concurrency: 4 },
  pokemon: { limit: 2000, concurrency: 4 },
  yugioh: { limit: 500, concurrency: 2 },
} as const;

const STEP = {
  retries: { limit: 3, delay: '30 seconds', backoff: 'exponential' },
  timeout: '30 minutes',
} satisfies WorkflowStepConfig;

/**
 * The last step of a catalog import Workflow (VB-57): mirrors the oldest pending images of the
 * game (`orig` only; the VPS adds `sm` nightly), so failures, over-cap days and new
 * localizations are retried every day. The import is already finished, so a failure here is
 * only logged; a 429 or a running mirror is not retried.
 */
export function mirrorStepFor(game: keyof typeof DELTA) {
  const { limit, concurrency } = DELTA[game];
  return async (env: Env, step: WorkflowStep) => {
    try {
      return await step.do('mirror images', STEP, () =>
        withDatabase(env, (db) =>
          mirrorImages(imageMirrorDeps(env), db, { game, limit }, { concurrency, verify: false }),
        ).catch((err: unknown) => {
          if (err instanceof SourceRateLimited || err instanceof MirrorBusy)
            throw new NonRetryableError(err.message);
          throw err;
        }),
      );
    } catch (err) {
      log('warn', { message: 'image mirror failed', game, error: String(err) });
      return undefined;
    }
  };
}
