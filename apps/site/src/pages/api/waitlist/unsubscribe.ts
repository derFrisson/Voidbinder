import type { APIRoute } from 'astro';
import { handleUnsubscribe, handleUnsubscribeLink } from '../../../server/waitlist/handlers';
import { withWaitlist } from '../../../server/waitlist/runtime';

export const prerender = false;

export const GET: APIRoute = ({ request }) => handleUnsubscribeLink(request);

// One-click POSTs from mail clients are answered in src/worker.ts before they reach Astro.
export const POST: APIRoute = ({ request, locals }) =>
  withWaitlist(locals.cfContext, (deps) => handleUnsubscribe(request, deps));
