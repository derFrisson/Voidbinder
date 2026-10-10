import { exports, WorkerEntrypoint, type WorkflowStep } from 'cloudflare:workers';
import type { EdgeCacheDeps } from '../../import/util';
import { log } from '../../middleware/log';

/**
 * Base of the Worker's default entrypoint (src/index.ts). Workers Caching scopes a purge to the
 * entrypoint that calls it, and each import Workflow is an entrypoint of its own, so the Workflows
 * purge the API's cached responses through this RPC method (`purgeCache` below).
 */
export class CachePurgingEntrypoint extends WorkerEntrypoint<Env> {
  async purgeCache(tags: string[]): Promise<void> {
    // Unset where Workers Caching is off (`wrangler dev`, the vitest pool): nothing to purge.
    const result = await this.ctx.cache?.purge({ tags });
    if (result && !result.success)
      log('warn', { message: 'cache purge failed', tags, errors: result.errors });
  }
}

/**
 * Purges the API's edge cache by tag (README "Caching"). Never throws: a failed purge leaves the
 * responses until their TTL (10 min), which must not fail the import that changed the data.
 */
export async function purgeCache(tags: string[]): Promise<void> {
  try {
    await exports.default.purgeCache(tags);
  } catch (err) {
    log('warn', { message: 'cache purge failed', tags, error: String(err) });
  }
}

/** What an import Workflow hands its pipeline to purge the edge cache: the purge and `step.sleep`. */
export function edgeCacheDeps(step: WorkflowStep): Required<EdgeCacheDeps> {
  return { purgeCache, sleep: (name, seconds) => step.sleep(name, seconds * 1000) };
}
