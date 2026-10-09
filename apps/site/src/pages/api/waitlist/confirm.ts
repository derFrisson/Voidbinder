import type { APIRoute } from 'astro';
import { handleConfirm } from '../../../server/waitlist/handlers';
import { withWaitlist } from '../../../server/waitlist/runtime';

export const prerender = false;

export const GET: APIRoute = ({ request, locals }) =>
  withWaitlist(locals.cfContext, (deps) => handleConfirm(request, deps));
