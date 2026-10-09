import type { APIRoute } from 'astro';
import { handleUnsubscribe } from '../../../server/waitlist/handlers';
import { withWaitlist } from '../../../server/waitlist/runtime';

export const prerender = false;

const unsubscribe: APIRoute = ({ request, locals }) =>
  withWaitlist(locals.cfContext, (deps) => handleUnsubscribe(request, deps));

export const GET = unsubscribe;
export const POST = unsubscribe;
