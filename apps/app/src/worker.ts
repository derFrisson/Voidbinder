import { securityHeaders } from './security-headers';

/**
 * Worker of the web app (wrangler.jsonc). Static assets, the SPA fallback included, are served
 * before this code runs; `run_worker_first` sends `/api/*` here, which goes to the API Worker
 * through the `API` service binding, so the auth cookies are first-party (apps/api/README.md,
 * "The web app's proxy").
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api' || url.pathname.startsWith('/api/'))
      return proxy(request, url, env);
    // Not reached for assets; kept so a request that does land here still gets the app. The
    // analytics host is in the CSP of dist/_headers only, so HTML served from here would block it.
    return withSecurityHeaders(await env.ASSETS.fetch(request));
  },
} satisfies ExportedHandler<Env>;

async function proxy(request: Request, url: URL, env: Env): Promise<Response> {
  // `/api/auth/sign-in/email` is `/auth/sign-in/email` on the API (Better Auth's basePath is /auth).
  const target = new URL(url.pathname.slice('/api'.length) || '/', url.origin);
  target.search = url.search;
  const forwarded = new Request(target, request);
  // The API's rate limits count per client IP: pass the client's own on, never this Worker's.
  const ip = request.headers.get('cf-connecting-ip');
  if (ip) forwarded.headers.set('cf-connecting-ip', ip);
  const response = await env.API.fetch(forwarded);
  // The bearer token is for native clients; the browser keeps to its HttpOnly cookie.
  const out = new Response(response.body, response);
  out.headers.delete('set-auth-token');
  return out;
}

function withSecurityHeaders(response: Response): Response {
  const out = new Response(response.body, response);
  for (const [name, value] of Object.entries(securityHeaders)) out.headers.set(name, value);
  return out;
}
