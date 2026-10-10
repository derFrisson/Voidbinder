import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
  type WorkflowStepConfig,
} from 'cloudflare:workers';
import { refreshSearchIndex } from '../import/search-index';
import { log } from '../middleware/log';
import { withDatabase } from '../platform/cloudflare';
import { purgeCache } from '../platform/cloudflare/cache';

/** Every step: three retries with backoff; a chunk is a few thousand rows each way. */
const STEP = {
  retries: { limit: 3, delay: '30 seconds', backoff: 'exponential' },
  timeout: '10 minutes',
} satisfies WorkflowStepConfig;

export interface SearchIndexRefreshParams {
  /** Rewrite every set (POST /admin/search-index/rebuild); default: the changed ones. */
  full?: boolean;
}

/**
 * Binding `SEARCH_INDEX_REFRESH` (VB-98): brings the D1 search index up to Postgres
 * (src/import/search-index.ts). Started by the last step of every catalog import and by
 * POST /admin/search-index/rebuild.
 */
export class SearchIndexRefreshWorkflow extends WorkflowEntrypoint<Env, SearchIndexRefreshParams> {
  override async run(event: WorkflowEvent<SearchIndexRefreshParams>, step: WorkflowStep) {
    return refreshSearchIndex(
      {
        d1: this.env.SEARCH,
        withDb: (fn) => withDatabase(this.env, fn),
        purgeCache,
        sleep: (name, seconds) => step.sleep(name, seconds * 1000),
      },
      // Every step result is plain JSON (ids, hashes, counts); Workflows persists it.
      (name, fn) => step.do(name, STEP, fn as () => Promise<never>),
      { full: event.payload?.full === true, owner: event.instanceId },
    );
  }
}

/**
 * The last step of a catalog import Workflow: starts a refresh of the search index, which waits
 * if another one is running. The import is done by then, so a failed start is only logged; the
 * next import starts another.
 */
export async function refreshSearchIndexStep(env: Env, step: WorkflowStep): Promise<string | null> {
  try {
    return await step.do('refresh search index', STEP, async () => {
      const instance = await env.SEARCH_INDEX_REFRESH.create({ params: {} });
      return instance.id;
    });
  } catch (err) {
    log('error', { message: 'search index refresh not started', error: String(err) });
    return null;
  }
}
