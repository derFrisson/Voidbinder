import { createApp, type App } from './app';
import { CRON_SOURCES, cronInstanceId } from './import/schedule';
import { CachePurgingEntrypoint } from './platform/cloudflare/cache';
import {
  appDeps,
  startScryfallImport,
  startTcgcsvCron,
  startTcgdexCron,
  startYgoprodeckImport,
  withDatabase,
} from './platform/cloudflare';
import { sweepSyncDeletions } from './platform/cloudflare/drizzle-sync-store';

export { ScryfallImportWorkflow } from './workflows/scryfall-import';
export { TcgcsvImportWorkflow } from './workflows/tcgcsv-import';
export { TcgdexImportWorkflow } from './workflows/tcgdex-import';
export { YgoprodeckImportWorkflow } from './workflows/ygoprodeck-import';

const START = {
  scryfall: startScryfallImport,
  ygoprodeck: startYgoprodeckImport,
  // Skips the start while a TCGdex run is still going (a full run outlasts a day).
  tcgdex: startTcgdexCron,
  // The same check for TCGCSV, whose 22:30 run could meet a slow 20:30 one.
  tcgcsv: startTcgcsvCron,
};

let app: App | undefined;

/** The API; a class entrypoint so the import Workflows can purge its edge cache (README "Caching"). */
export default class Api extends CachePurgingEntrypoint {
  override fetch(request: Request) {
    // One app per isolate: the vars never change within it, the platform opens per request.
    app ??= createApp(appDeps(this.env));
    return app.fetch(request, this.env, this.ctx);
  }

  /**
   * Each cron starts the import CRON_SOURCES names; one Workflow instance per cron and day. The
   * daily Scryfall cron (every environment has one) also sweeps the sync deletion log (VB-75).
   */
  override async scheduled(controller: ScheduledController) {
    const source = CRON_SOURCES[controller.cron];
    if (!source) throw new Error(`no import for cron ${controller.cron}`);
    if (source === 'scryfall')
      this.ctx.waitUntil(withDatabase(this.env, (db) => sweepSyncDeletions(db)));
    await START[source](
      this.env,
      cronInstanceId(controller.cron, source, controller.scheduledTime),
    );
  }
}

export type AppType = App;
