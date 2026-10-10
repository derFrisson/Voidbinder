import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
  type WorkflowStepConfig,
} from 'cloudflare:workers';
import { runTcgcsvImport, type PriceImportOptions } from '../import/prices/pipeline';
import { purgeEdgeCache } from '../import/util';
import { tcgcsvImportDeps } from '../platform/cloudflare';
import { edgeCacheDeps } from '../platform/cloudflare/cache';
import { mirrorStepFor } from './mirror-images';
import { refreshSearchIndexStep } from './search-index-refresh';

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
 * groups (a set's groups together). When Yu-Gi-Oh! prints took an artwork from their product's
 * name (VB-119), the image mirror, one `catalog` purge and the search index follow, as after the
 * Yugipedia galleries.
 */
export class TcgcsvImportWorkflow extends WorkflowEntrypoint<Env, TcgcsvImportParams> {
  override async run(event: WorkflowEvent<TcgcsvImportParams>, step: WorkflowStep) {
    const deps = { ...tcgcsvImportDeps(this.env), ...edgeCacheDeps(step) };
    const runner = (name: string, fn: () => Promise<unknown>) =>
      step.do(name, STEP, fn as () => Promise<never>);
    const result = await runTcgcsvImport(deps, runner, {
      env: this.env.IMPORT_ENV,
      date: event.timestamp.toISOString().slice(0, 10),
      // The cron starts the Workflow without a payload.
      force: event.payload?.force === true,
      // Unset in wrangler.jsonc: off until the licence of TCGplayer's images is settled.
      tcgplayerImages: ['1', 'true'].includes(
        String((this.env as Env & { TCGPLAYER_IMAGES?: string }).TCGPLAYER_IMAGES),
      ),
    });
    if (!('games' in result.stats && result.stats.games.yugioh?.artworks)) return result;
    const images = await mirrorStepFor('yugioh')(this.env, step);
    await purgeEdgeCache(deps, runner, ['catalog'], 'artworks: ');
    const searchIndex = await refreshSearchIndexStep(this.env, step);
    return { ...result, images, searchIndex };
  }
}
