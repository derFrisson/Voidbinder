import type { APIRoute } from 'astro';
import { handleSignup } from '../../../server/waitlist/handlers';
import { withWaitlist } from '../../../server/waitlist/runtime';

export const prerender = false;

export const POST: APIRoute = ({ request, locals }) =>
  withWaitlist(locals.cfContext, (deps) => handleSignup(request, deps));
