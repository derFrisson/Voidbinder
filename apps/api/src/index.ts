import { createApp, type App } from './app';
import { CRON_SOURCES } from './import/schedule';
import { appDeps, startScryfallImport, startYgoprodeckImport } from './platform/cloudflare';

export { ScryfallImportWorkflow } from './workflows/scryfall-import';
export { YgoprodeckImportWorkflow } from './workflows/ygoprodeck-import';

const START = { scryfall: startScryfallImport, ygoprodeck: startYgoprodeckImport };

let app: App | undefined;

export default {
  fetch(request, env, ctx) {
    // One app per isolate: the vars never change within it, the platform opens per request.
    app ??= createApp(appDeps(env));
    return app.fetch(request, env, ctx);
  },

  /** Each cron starts the import CRON_SOURCES names; one Workflow instance per source and day. */
  async scheduled(controller, env) {
    const source = CRON_SOURCES[controller.cron];
    if (!source) throw new Error(`no import for cron ${controller.cron}`);
    const day = new Date(controller.scheduledTime).toISOString().slice(0, 10);
    await START[source](env, `${source}-${day}`);
  },
} satisfies ExportedHandler<Env>;

export type AppType = App;
