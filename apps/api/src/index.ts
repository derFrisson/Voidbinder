import { createApp, type App } from './app';
import { appDeps, startScryfallImport, startYgoprodeckImport } from './platform/cloudflare';

export { ScryfallImportWorkflow } from './workflows/scryfall-import';
export { YgoprodeckImportWorkflow } from './workflows/ygoprodeck-import';

/** The cron expressions of wrangler.jsonc that start the YGOPRODeck import. */
const YGOPRODECK_CRONS = new Set(['30 3 * * *', '0 5 * * *']);

let app: App | undefined;

export default {
  fetch(request, env, ctx) {
    // One app per isolate: the vars never change within it, the platform opens per request.
    app ??= createApp(appDeps(env));
    return app.fetch(request, env, ctx);
  },

  /**
   * Crons (prod, dev): Scryfall `0 3 * * *` / `30 4 * * *`, YGOPRODeck `30 3 * * *` / `0 5 * * *`.
   * One Workflow instance per source and day.
   */
  async scheduled(controller, env) {
    const day = new Date(controller.scheduledTime).toISOString().slice(0, 10);
    if (YGOPRODECK_CRONS.has(controller.cron))
      await startYgoprodeckImport(env, `ygoprodeck-${day}`);
    else await startScryfallImport(env, `scryfall-${day}`);
  },
} satisfies ExportedHandler<Env>;

export type AppType = App;
