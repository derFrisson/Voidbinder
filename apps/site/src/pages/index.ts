import type { APIRoute } from 'astro';
import { negotiateLocale } from '../i18n';

// `/` has no page of its own: the Worker sends visitors to /de/ or /en/ by Accept-Language,
// German when nothing matches. Prerendered pages are served as static assets before the Worker.
export const prerender = false;

export const GET: APIRoute = ({ request }) => {
  const locale = negotiateLocale(request.headers.get('accept-language'));
  return new Response(null, {
    status: 302,
    headers: { Location: `/${locale}/`, Vary: 'Accept-Language' },
  });
};
