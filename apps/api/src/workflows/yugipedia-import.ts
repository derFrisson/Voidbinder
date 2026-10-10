import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
  type WorkflowStepConfig,
} from 'cloudflare:workers';
import { runGalleryImport } from '../import/yugipedia/galleries';
import { runYugipediaImport } from '../import/yugipedia/pipeline';
import { runSetListImport } from '../import/yugipedia/set-lists';
import { purgeEdgeCache } from '../import/util';
import { scryfallImportDeps } from '../platform/cloudflare';
import { edgeCacheDeps } from '../platform/cloudflare/cache';
import { mirrorStepFor } from './mirror-images';
import { refreshSearchIndexStep } from './search-index-refresh';

/** Every step: three retries with backoff; a step is about twenty requests a second apart. */
const STEP = {
  retries: { limit: 3, delay: '30 seconds', backoff: 'exponential' },
  timeout: '10 minutes',
} satisfies WorkflowStepConfig;

/**
 * Binding `YUGIPEDIA_IMPORT`: the Yugipedia localization import (src/import/yugipedia/pipeline.ts)
 * with one durable step per 100 cards, then the artworks of the set galleries (galleries.ts,
 * VB-106) with one step per 20 sets and the image mirror for the scans they found, then the codes
 * of the set lists (set-lists.ts, VB-94) with one step per 50 sets. A failed step is retried;
 * completed steps are never repeated within the instance. `POST /admin/import/yugipedia-galleries`
 * starts it with `{ galleries: 'only' }`: the galleries alone.
 */
export class YugipediaImportWorkflow extends WorkflowEntrypoint<Env> {
  override async run(event: WorkflowEvent<{ galleries?: 'only' } | undefined>, step: WorkflowStep) {
    const deps = { ...scryfallImportDeps(this.env), ...edgeCacheDeps(step) };
    // Every step result is plain JSON (counts); Workflows persists it.
    const runner = (name: string, fn: () => Promise<unknown>) =>
      step.do(name, STEP, fn as () => Promise<never>);
    const opts = { env: this.env.IMPORT_ENV, date: event.timestamp.toISOString().slice(0, 10) };
    const names =
      event.payload?.galleries === 'only' ? null : await runYugipediaImport(deps, runner, opts);
    const galleries = await runGalleryImport(deps, runner, opts);
    // The new scans into R2 now, not with the next daily YGOPRODeck run (at most 500, 1/s); then
    // one purge for the artworks and the keys the mirror replaced (the rest keep their old key).
    const images = galleries.stats.written ? await mirrorStepFor('yugioh')(this.env, step) : null;
    // And the rarities the galleries named (VB-117).
    if (galleries.stats.written || galleries.stats.rarities)
      await purgeEdgeCache(deps, runner, ['catalog'], 'galleries: ');
    const setLists = names ? await runSetListImport(deps, runner, opts) : null;
    // The names and codes this run wrote reach the D1 typeahead (VB-98) now, not with the next
    // daily import.
    const searchIndex =
      names?.stats.written || setLists?.stats.written
        ? await refreshSearchIndexStep(this.env, step)
        : null;
    return { ...names, galleries, images, setLists, searchIndex };
  }
}
