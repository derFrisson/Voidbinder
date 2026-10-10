import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
  type WorkflowStepConfig,
} from 'cloudflare:workers';
import { runTcgcsvImport, type PriceImportOptions } from '../import/prices/pipeline';
import { tcgcsvImportDeps } from '../platform/cloudflare';
import { edgeCacheDeps } from '../platform/cloudflare/cache';

/** Every step: three retries with backoff; a step is 25 groups, about 50 small requests. */
const STEP = {
  retries: { limit: 3, delay: '30 seconds', backoff: 'exponential' },
  timeout: '30 minutes',
} satisfies WorkflowStepConfig;

export interface TcgcsvImportParams {
  /** Imports TCGCSV's build even when the last run did (`POST /admin/import/tcgcsv?force=true`). */
  force?: PriceImportOptions['force'];
}

/**
 * Binding `TCGCSV_IMPORT`: the daily TCGplayer prices from TCGCSV
 * (src/import/prices/pipeline.ts), one durable step per game's groups and per about 25 matched
 * groups (a set's groups together).
 * No image step: the run touches prices only.
 */
export class TcgcsvImportWorkflow extends WorkflowEntrypoint<Env, TcgcsvImportParams> {
  override async run(event: WorkflowEvent<TcgcsvImportParams>, step: WorkflowStep) {
    return runTcgcsvImport(
      { ...tcgcsvImportDeps(this.env), ...edgeCacheDeps(step) },
      (name, fn) => step.do(name, STEP, fn as () => Promise<never>),
      {
        env: this.env.IMPORT_ENV,
        date: event.timestamp.toISOString().slice(0, 10),
        // The cron starts the Workflow without a payload.
        force: event.payload?.force === true,
      },
    );
  }
}
