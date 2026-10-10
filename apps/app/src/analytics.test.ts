import { init } from '@plausible-analytics/tracker';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@plausible-analytics/tracker', () => ({ init: vi.fn() }));

// `started` is module state, so every test gets a fresh copy of the module.
beforeEach(() => {
  vi.resetModules();
  vi.mocked(init).mockClear();
});
const load = () => import('./analytics');

describe('analytics', () => {
  it('never loads the tracker when the host or the domain is unset', async () => {
    const { initAnalytics } = await load();
    initAnalytics(undefined, undefined);
    initAnalytics('https://plausible.example.test', undefined);
    initAnalytics(undefined, 'app.example.test');
    initAnalytics('', '');
    expect(init).not.toHaveBeenCalled();
  });

  it('initialises once with the domain and the /api/event endpoint', async () => {
    const { initAnalytics, stripQuery } = await load();
    initAnalytics('https://plausible.example.test/', 'app.example.test');
    initAnalytics('https://plausible.example.test/', 'app.example.test');
    expect(init).toHaveBeenCalledOnce();
    expect(init).toHaveBeenCalledWith({
      domain: 'app.example.test',
      endpoint: 'https://plausible.example.test/api/event',
      logging: false,
      transformRequest: stripQuery,
    });
  });

  it('sends the path of a pageview only, query and hash dropped from URL and referrer', async () => {
    const { stripQuery } = await load();
    const sent = stripQuery({
      n: 'pageview',
      d: 'app.example.test',
      u: 'https://app.example.test/search?q=black+lotus&game=mtg#top',
      r: 'https://app.example.test/collection?binder=7',
    });
    expect(sent).toMatchObject({
      n: 'pageview',
      u: 'https://app.example.test/search',
      r: 'https://app.example.test/collection',
    });
    expect(stripQuery({ n: 'pageview', d: 'x', u: 'https://x.test/', r: null }).r).toBeNull();
  });

  it('reports private ids as patterns and leaves public catalog paths alone', async () => {
    const { pathOnly } = await load();
    expect(pathOnly('https://app.example.test/decks/abc123?x=1')).toBe(
      'https://app.example.test/decks/:id',
    );
    expect(pathOnly('https://app.example.test/decks/abc123/')).toBe(
      'https://app.example.test/decks/:id/',
    );
    expect(pathOnly('/decks/abc123#top')).toBe('/decks/:id');
    for (const path of ['/decks', '/cards/abc123', '/mtg/sets/lea', '/search', '/collection'])
      expect(pathOnly(`https://app.example.test${path}`)).toBe(`https://app.example.test${path}`);
  });
});
