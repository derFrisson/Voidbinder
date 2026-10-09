import { createApp, type App } from './app';
import { logMailSender } from './auth/mail';
import { createPlatform } from './platform/cloudflare';
import { bindingMailSender } from './platform/cloudflare/mail-sender';

let app: App | undefined;

export default {
  fetch(request, env, ctx) {
    // One app per isolate: the vars never change within it, the platform opens per request.
    app ??= createApp({
      appUrl: env.APP_URL,
      extraOrigins: (env.CORS_EXTRA_ORIGINS ?? '').split(',').filter(Boolean),
      version: env.VERSION,
      auth: {
        secret: env.BETTER_AUTH_SECRET,
        apiUrl: env.API_URL,
        mail: env.EMAIL ? bindingMailSender(env.EMAIL) : logMailSender,
      },
      openPlatform: () => createPlatform(env),
    });
    return app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;

export type AppType = App;
