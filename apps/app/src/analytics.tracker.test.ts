import { init } from '@plausible-analytics/tracker';
import { expect, it, vi } from 'vitest';
import { stripQuery } from './analytics';

// The real tracker, only the network stubbed: a route change must post a pageview whose URL has
// no query (the mocked tests in analytics.test.ts cannot see the tracker's pushState hook).
it('posts a pageview with the path only when the route changes', async () => {
  const fetchMock = vi.fn().mockResolvedValue({ status: 202 });
  vi.stubGlobal('fetch', fetchMock);
  Object.defineProperty(navigator, 'webdriver', { value: false, configurable: true });
  init({
    domain: 'app.example.test',
    endpoint: 'https://plausible.example.test/api/event',
    captureOnLocalhost: true,
    logging: false,
    transformRequest: stripQuery,
  });
  fetchMock.mockClear();

  history.pushState({}, '', '/search?q=black+lotus');
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

  const request = fetchMock.mock.calls.at(-1)?.[1] as { body: string };
  const body = JSON.parse(request.body);
  expect(body.n).toBe('pageview');
  expect(body.u).toMatch(/\/search$/);
  expect(body.u).not.toContain('?');
});
