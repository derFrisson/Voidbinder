import { createApp, type App } from './app';
import { createPlatform, startScryfallImport, startTcgdexImport } from './platform/cloudflare';

export { ScryfallImportWorkflow } from './workflows/scryfall-import';
export { TcgdexImportWorkflow } from './workflows/tcgdex-import';

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

  /**
   * Cron (prod `0 3 * * *`, dev `30 4 * * *`): the daily imports, one instance of each per day. A
   * failed start of one never keeps the others from starting.
   */
  async scheduled(controller, env) {
    const day = new Date(controller.scheduledTime).toISOString().slice(0, 10);
    const started = await Promise.allSettled([
      startScryfallImport(env, `scryfall-${day}`),
      startTcgdexImport(env, `tcgdex-${day}`),
    ]);
    const failed = started.find((r) => r.status === 'rejected');
    if (failed) throw failed.reason;
  },
} satisfies ExportedHandler<Env>;

export type AppType = App;
