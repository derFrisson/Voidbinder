import AxeBuilder from '@axe-core/playwright';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The exported web build (`pnpm build`, which turbo runs before the tests) served by the Worker
// that ships (`wrangler dev`), in real Chromium. The API is faked with Playwright routes, so no
// API Worker is needed. Needs `pnpm exec playwright install chromium` once.
const root = new URL('..', import.meta.url);

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = createServer().once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });

const me = {
  id: 'u1',
  email: 'ada@example.test',
  emailVerified: true,
  name: 'Ada Lovelace',
  displayName: null,
  language: 'de',
  currency: 'EUR',
  trainingDataOptIn: false,
  deletionRequestedAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
};
const games = {
  games: [
    { id: 'mtg', name: 'Magic: The Gathering', setCount: 778 },
    { id: 'pokemon', name: 'Pokémon', setCount: 0 },
    { id: 'yugioh', name: 'Yu-Gi-Oh!', setCount: 0 },
    { id: 'onepiece', name: 'One Piece Card Game', setCount: 0 },
  ],
};

// The search and card page (VB-35); no images, so the test needs no network.
const CARD = '2d112e72-f8b2-48e0-9798-208873db6761';
const PRINT = '22222222-2222-4222-8222-222222222222';
const search = {
  prints: [
    {
      id: PRINT,
      cardId: CARD,
      number: '1',
      variant: '',
      name: 'Adeline, strahlende Katharerin',
      rarity: 'rare',
      finishes: ['normal', 'foil'],
      imageUrl: null,
      game: 'mtg',
      setCode: 'mid',
      setName: 'Innistrad: Midnight Hunt',
    },
  ],
  page: 1,
  pageSize: 30,
  total: 1,
};
const card = {
  card: {
    id: CARD,
    game: 'mtg',
    name: 'Adeline, Resplendent Cathar',
    typeLine: 'Legendary Creature — Human Knight',
    text: 'Vigilance',
    attributes: { cmc: 3, mana_cost: '{1}{W}{W}', power: '*', toughness: '4', colors: ['W'] },
    legalities: { standard: 'not_legal', commander: 'legal' },
  },
  prints: [
    {
      id: PRINT,
      cardId: CARD,
      set: { game: 'mtg', code: 'mid', name: 'Innistrad: Midnight Hunt' },
      number: '1',
      variant: '',
      rarity: 'rare',
      finishes: ['normal', 'foil'],
      artist: 'Bryan Sola',
      releasedOn: '2021-09-24',
      imageUrl: null,
      externalIds: {},
      localizations: [
        { lang: 'de', name: 'Adeline, strahlende Katharerin', text: 'Wachsamkeit', imageUrl: null },
        { lang: 'en', name: 'Adeline, Resplendent Cathar', text: 'Vigilance', imageUrl: null },
      ],
    },
  ],
  copyright: '©Wizards of the Coast LLC',
};

let worker: ChildProcess | undefined;
let browser: Browser | undefined;
let origin = '';

type Options = { width?: number; height?: number; scheme?: 'light' | 'dark' };

/** A page with the fake API; `posts` collects every POST body by path, `csp` every CSP violation. */
async function open({ width = 1440, height = 900, scheme = 'light' }: Options = {}) {
  if (!browser) throw new Error('browser did not start');
  const context = await browser.newContext({
    viewport: { width, height },
    colorScheme: scheme,
    locale: 'de-DE',
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const posts = new Map<string, unknown>();
  const csp: string[] = [];
  let signedIn = false;
  page.on('console', (m) => {
    if (m.text().includes('Content Security Policy')) csp.push(m.text());
  });
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (req.method() === 'POST') posts.set(path, req.postDataJSON());
    if (path === '/api/auth/sign-in/email') {
      signedIn = true;
      return route.fulfill({ json: { token: 't', user: { id: 'u1' } } });
    }
    if (path === '/api/me') {
      return signedIn
        ? route.fulfill({ json: me })
        : route.fulfill({
            status: 401,
            json: { error: { code: 'unauthorized', message: 'x', requestId: 'r' } },
          });
    }
    if (path === '/api/catalog/games') return route.fulfill({ json: games });
    if (path === '/api/catalog/search') return route.fulfill({ json: search });
    if (path === `/api/catalog/cards/${CARD}`) return route.fulfill({ json: card });
    return route.fulfill({
      status: 404,
      json: { error: { code: 'not_found', message: 'x', requestId: 'r' } },
    });
  });
  return { context, page, posts, csp };
}

async function axe(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  return violations.map(
    (v) =>
      `${v.id}: ${v.nodes.map((n) => `${n.target.join(' ')} ${n.failureSummary ?? ''}`).join(', ')}`,
  );
}

beforeAll(async () => {
  const port = await freePort();
  origin = `http://127.0.0.1:${port}`;
  // detached: the group is killed below, `pnpm exec` leaves wrangler and workerd as grandchildren.
  worker = spawn('pnpm', ['exec', 'wrangler', 'dev', '--port', String(port), '--ip', '127.0.0.1'], {
    cwd: root,
    detached: true,
    stdio: 'ignore',
  });
  for (let i = 0; ; i++) {
    const ok = await fetch(`${origin}/`).then(
      (r) => r.ok,
      () => false,
    );
    if (ok) break;
    if (i > 90) throw new Error('wrangler dev did not come up');
    await new Promise((r) => setTimeout(r, 1000));
  }
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();
  if (worker?.pid) process.kill(-worker.pid, 'SIGTERM');
});

describe('web build', () => {
  it('renders the home page with the four games and keeps to the CSP', async () => {
    const { context, page, csp } = await open();
    try {
      await page.goto(`${origin}/`);
      await page.getByRole('heading', { level: 1, name: 'Spiele' }).waitFor();
      await page.getByText('778 Sets').waitFor();
      for (const name of ['Pokémon', 'Yu‑Gi‑Oh!', 'Magic: The Gathering', 'One Piece']) {
        expect(await page.getByText(name, { exact: true }).count()).toBe(1);
      }
      expect(await page.getByText('kommt später').count()).toBe(1);
      expect(csp).toEqual([]);
    } finally {
      await context.close();
    }
  });

  it('serves a deep link (SPA fallback) and sends a signed-out visitor to sign-in', async () => {
    const { context, page } = await open();
    try {
      await page.goto(`${origin}/profile`);
      await page.waitForURL(/\/sign-in\?next=%2Fprofile$/);
    } finally {
      await context.close();
    }
  });

  it('posts the sign-in form and goes on to the page it came from', async () => {
    const { context, page, posts, csp } = await open();
    try {
      await page.goto(`${origin}/sign-in?next=/profile`);
      await page.getByLabel('E-Mail-Adresse').fill('ada@example.test');
      await page.getByLabel('Passwort').fill('correct horse battery');
      await page.getByRole('button', { name: 'Anmelden' }).click();
      await page.waitForURL(/\/profile$/);
      await page.getByText('ada@example.test').first().waitFor();
      expect(posts.get('/api/auth/sign-in/email')).toEqual({
        email: 'ada@example.test',
        password: 'correct horse battery',
      });
      expect(csp).toEqual([]);
    } finally {
      await context.close();
    }
  });

  it('searches, opens the card and shows no price', async () => {
    const { context, page, csp } = await open();
    try {
      await page.goto(`${origin}/search?q=adeline`);
      await page.getByText('1 Treffer').waitFor();
      await page.getByRole('link', { name: 'Adeline, strahlende Katharerin, MID 1' }).click();
      await page.waitForURL(new RegExp(`/cards/${CARD}\\?print=${PRINT}$`));
      await page
        .getByRole('heading', { level: 1, name: 'Adeline, strahlende Katharerin' })
        .waitFor();
      await page.getByText('Für diesen Druck gibt es noch keine Preise.').waitFor();
      expect(csp).toEqual([]);
    } finally {
      await context.close();
    }
  });

  // WCAG 2.2 AA, automated, like the site (apps/site/test/a11y.test.ts).
  const cases = (['light', 'dark'] as const).flatMap((scheme) =>
    [
      ['desktop', 1440, 900],
      ['phone', 390, 844],
    ].flatMap(([name, width, height]) =>
      ['/', '/sign-in', '/search?q=adeline', `/cards/${CARD}`].map(
        (path) => [scheme, name, path, width, height] as const,
      ),
    ),
  );
  it.each(cases)('axe: %s %s %s has no violations', async (scheme, _name, path, width, height) => {
    const { context, page } = await open({
      width: width as number,
      height: height as number,
      scheme,
    });
    try {
      await page.goto(origin + path);
      await page.getByRole('navigation').first().waitFor();
      await page.waitForLoadState('networkidle');
      expect(await axe(page)).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
