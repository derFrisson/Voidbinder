import { createApp, type App } from './app';
import { CRON_SOURCES, cronInstanceId } from './import/schedule';
import {
  appDeps,
  startScryfallImport,
  startTcgcsvCron,
  startTcgdexCron,
  startYgoprodeckImport,
} from './platform/cloudflare';

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

export default {
  fetch(request, env, ctx) {
    // One app per isolate: the vars never change within it, the platform opens per request.
    app ??= createApp(appDeps(env));
    return app.fetch(request, env, ctx);
  },

  /** Each cron starts the import CRON_SOURCES names; one Workflow instance per cron and day. */
  async scheduled(controller, env) {
    const source = CRON_SOURCES[controller.cron];
    if (!source) throw new Error(`no import for cron ${controller.cron}`);
    await START[source](env, cronInstanceId(controller.cron, source, controller.scheduledTime));
  },
} satisfies ExportedHandler<Env>;

export type AppType = App;
