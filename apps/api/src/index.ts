import { createApp, type App } from './app';
import { createPlatform, startScryfallImport } from './platform/cloudflare';

export { ScryfallImportWorkflow } from './workflows/scryfall-import';

let app: App | undefined;

export default {
  fetch(request, env, ctx) {
    // One app per isolate: the vars never change within it, the platform opens per request.
    app ??= createApp({
      appUrl: env.APP_URL,
      version: env.VERSION,
      adminToken: env.ADMIN_TOKEN,
      openPlatform: () => createPlatform(env),
    });
    return app.fetch(request, env, ctx);
  },

  /** Cron (prod `0 3 * * *`, dev `30 4 * * *`): the daily Scryfall import, one instance per day. */
  async scheduled(controller, env) {
    const day = new Date(controller.scheduledTime).toISOString().slice(0, 10);
    await startScryfallImport(env, `scryfall-${day}`);
  },
} satisfies ExportedHandler<Env>;

export type AppType = App;
