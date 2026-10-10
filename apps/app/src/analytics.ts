import { init, type PlausibleRequestPayload } from '@plausible-analytics/tracker';
import { Platform } from 'react-native';

// Self-hosted Plausible (VB-74), web only. Both values are inlined by `expo export`; either one
// unset and the tracker is never loaded. Nothing personal leaves the browser: Plausible sets no
// cookie and the tracker writes no storage (it only reads localStorage.plausible_ignore).
// Expo Router navigates with history.pushState, which the tracker hooks, so every route change is
// a pageview without extra code.

// Private routes whose path carries an id that belongs to one user. Plausible would list one row
// per id and Voidbinder can join the id back to an account, so each is reported as its pattern.
// Binders and collection entries have no path ids (the binder is the `binder` query parameter,
// which is dropped anyway); public catalog paths (/cards/:id, /:game/sets/:code) stay as they are.
const PRIVATE_PATHS: [RegExp, string][] = [[/^\/decks\/[^/]+/, '/decks/:id']];

function anonymise(pathname: string): string {
  for (const [pattern, replacement] of PRIVATE_PATHS)
    pathname = pathname.replace(pattern, replacement);
  return pathname;
}

/** Drops the query and the hash from a URL (filters and search terms sit there) and the user's ids from the path. */
export function pathOnly(url: string): string {
  try {
    const u = new URL(url);
    return u.origin + anonymise(u.pathname);
  } catch {
    return anonymise(url.split(/[?#]/)[0] ?? '');
  }
}

/** The tracker's `transformRequest`: the event's URL and the referrer without query or hash. */
export function stripQuery(payload: PlausibleRequestPayload): PlausibleRequestPayload {
  return { ...payload, u: pathOnly(payload.u), ...(payload.r && { r: pathOnly(payload.r) }) };
}

let started = false;

/** Starts the tracker once; does nothing off the web or without a configured host and domain. */
export function initAnalytics(
  host = process.env.EXPO_PUBLIC_PLAUSIBLE_HOST,
  domain = process.env.EXPO_PUBLIC_PLAUSIBLE_DOMAIN,
) {
  if (started || Platform.OS !== 'web' || !host || !domain) return;
  started = true;
  init({
    domain,
    endpoint: `${host.replace(/\/+$/, '')}/api/event`,
    logging: false,
    transformRequest: stripQuery,
  });
}
