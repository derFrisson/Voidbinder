import { createApp, type App } from './app';
import { log } from './middleware/log';
import { createPlatform } from './platform/cloudflare';

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

  /** Cron `0 3 * * *`: the daily Scryfall import, one instance per day (the id makes it unique). */
  async scheduled(controller, env) {
    const id = `scryfall-${new Date(controller.scheduledTime).toISOString().slice(0, 10)}`;
    const instance = await env.SCRYFALL_IMPORT.create({ id });
    log('info', { message: 'workflow started', job: 'scryfall-import', instanceId: instance.id });
  },
} satisfies ExportedHandler<Env>;

export type AppType = App;
