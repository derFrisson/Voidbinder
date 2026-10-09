import { createApp, type App } from './app';
import { createPlatform } from './platform/cloudflare';

let app: App | undefined;

export default {
  fetch(request, env, ctx) {
    // One app per isolate: the vars never change within it, the platform opens per request.
    app ??= createApp({
      appUrl: env.APP_URL,
      version: env.VERSION,
      openPlatform: () => createPlatform(env),
    });
    return app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;

export type AppType = App;
