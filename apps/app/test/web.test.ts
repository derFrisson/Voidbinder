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

const mtgSets = {
  game: 'mtg',
  sets: [
    {
      code: 'mid',
      name: 'Innistrad: Midnight Hunt',
      localizedName: null,
      releasedOn: '2021-09-24',
      cardCount: 392,
      kind: 'expansion',
    },
    {
      code: 'vow',
      name: 'Crimson Vow',
      localizedName: null,
      releasedOn: '2021-11-19',
      cardCount: 277,
      kind: 'expansion',
    },
    {
      code: 'old',
      name: 'Old One',
      localizedName: null,
      releasedOn: null,
      cardCount: null,
      kind: null,
    },
  ],
};
const mid = (rarity: string | null) => ({
  set: { ...mtgSets.sets[0], game: 'mtg' },
  prints: [1, 2, 3, 4].map((n) => ({
    id: `00000000-0000-4000-8000-00000000000${n}`,
    cardId: `10000000-0000-4000-8000-00000000000${n}`,
    number: String(n),
    variant: '',
    name: `Adeline ${n}`,
    rarity: rarity ?? (n % 2 ? 'rare' : 'common'),
    finishes: ['normal', 'foil'],
    imageUrl: n === 1 ? 'https://img.voidbinder.de/images/mtg/1/en/sm.webp' : null,
  })),
  page: 1,
  pageSize: 60,
  total: 130,
  facets: {
    rarities: [
      { rarity: 'common', count: 123 },
      { rarity: 'rare', count: 130 },
    ],
    finishes: [
      { finish: 'normal', count: 391 },
      { finish: 'foil', count: 300 },
    ],
    languages: ['de', 'en'],
  },
});
// A 1 x 1 PNG for the one card with a picture.
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
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

// The collection (VB-31): one binder, one priced entry, an empty wish list.
const at = '2026-10-09T03:00:00.000Z';
const total = { source: 'cardmarket', currency: 'EUR', cents: 640, observedAt: at };
const group = { cards: 2, entries: 1, unpriced: 0, totals: [total] };
const binder = {
  id: 'b0000000-0000-4000-8000-000000000001',
  name: 'Magic Foils',
  game: 'mtg',
  position: 0,
  colour: null,
  createdAt: at,
  updatedAt: at,
};
const collectionApi: Record<string, unknown> = {
  summary: {
    collection: {
      ...group,
      estimate: true,
      games: [{ ...group, game: 'mtg' }],
      binders: [{ ...group, binderId: binder.id }],
    },
    wishlist: { cards: 0, entries: 0, unpriced: 0, totals: [], games: [], inBudget: 0 },
  },
  binders: { binders: [binder] },
  entries: {
    page: 1,
    pageSize: 50,
    total: 1,
    entries: [
      {
        id: 'e0000000-0000-4000-8000-000000000001',
        printId: 'p0000000-0000-4000-8000-000000000001',
        binderId: binder.id,
        quantity: 2,
        language: 'de',
        condition: 'EX',
        finish: 'foil',
        purchasePriceCents: null,
        purchaseCurrency: null,
        note: null,
        createdAt: at,
        updatedAt: at,
        print: {
          id: 'p0000000-0000-4000-8000-000000000001',
          cardId: 'c0000000-0000-4000-8000-000000000001',
          game: 'mtg',
          setCode: 'mid',
          setName: 'Innistrad: Midnight Hunt',
          number: '1',
          name: 'Adeline, strahlende Katharerin',
          rarity: 'rare',
          finishes: ['normal', 'foil'],
          imageUrl: null,
        },
        price: {
          source: 'cardmarket',
          finish: 'foil',
          currency: 'EUR',
          marketCents: 376,
          factor: 0.85,
          unitCents: 320,
          observedAt: at,
        },
      },
    ],
  },
  wishlist: { entries: [], page: 1, pageSize: 50, total: 0 },
  owned: { owned: {}, byFinish: {}, wished: {} },
};

// Two-factor setup (VB-68): what POST /auth/two-factor/enable answers.
const twoFactorSetup = {
  method: 'totp',
  totpURI:
    'otpauth://totp/Voidbinder:ada%40example.test?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Voidbinder&digits=6&period=30',
  backupCodes: Array.from({ length: 10 }, (_, i) => `K${i}X7Q-M2P4R`),
};

// A Yu-Gi-Oh! deck (VB-34): one owned and one missing card, one problem, prices.
const DECK = 'd0000000-0000-4000-8000-000000000001';
const eur = (cents: number) => ({
  source: 'cardmarket',
  finish: 'normal',
  currency: 'EUR',
  marketCents: cents,
  factor: 1,
  unitCents: cents,
  observedAt: at,
});
const deckLine = (n: number, name: string, extra: object) => ({
  cardId: `c0000000-0000-4000-8000-00000000000${n}`,
  printId: null,
  zone: 'main',
  quantity: 3,
  name,
  typeLine: 'Effect Monster',
  group: 'monster',
  stat: { kind: 'level', value: 4 },
  print: {
    id: `p0000000-0000-4000-8000-00000000000${n}`,
    setCode: 'lob',
    number: `EN00${n}`,
    imageUrl: null,
  },
  owned: 3,
  price: eur(120),
  ...extra,
});
const deck = {
  id: DECK,
  game: 'yugioh',
  name: 'Nebelwacht',
  format: 'advanced',
  description: null,
  createdAt: at,
  updatedAt: at,
  entries: [
    deckLine(1, 'Nebelwächter', {}),
    deckLine(2, 'Schleierorakel', { owned: 2, price: eur(890) }),
    deckLine(3, 'Ruf der Leere', { typeLine: 'Spell Card', group: 'spell', stat: null }),
  ],
  analysis: {
    valid: false,
    problems: [{ code: 'too_few', params: { zone: 'main', count: 9, min: 40 } }],
    rules: {
      zones: { main: { min: 40, max: 60 }, extra: { max: 15 }, side: { max: 15 } },
      copies: 3,
    },
    counts: { main: 9 },
    curve: {
      kind: 'level',
      buckets: ['1', '2', '3', '4', '5', '6', '7', '8+'].map((label) => ({
        label,
        count: label === '4' ? 6 : 0,
      })),
    },
    missing: [
      {
        cardId: 'c0000000-0000-4000-8000-000000000002',
        name: 'Schleierorakel',
        printId: 'p0000000-0000-4000-8000-000000000002',
        setCode: 'lob',
        number: 'EN002',
        needed: 3,
        owned: 2,
        unitPriceCents: 890,
        currency: 'EUR',
        source: 'cardmarket',
        observedAt: at,
      },
    ],
    missingValue: { cards: 1, entries: 1, unpriced: 0, totals: [{ ...total, cents: 890 }] },
    value: { cards: 9, entries: 3, unpriced: 0, totals: [{ ...total, cents: 3750 }] },
    collectionCards: 612,
  },
};
const decksList = {
  decks: [{ ...deck, valid: false, problems: 1, cards: 9, missing: 1, value: deck.analysis.value }],
};

let worker: ChildProcess | undefined;
let browser: Browser | undefined;
let origin = '';

type Options = {
  width?: number;
  height?: number;
  scheme?: 'light' | 'dark';
  /** Start signed in (the protected screens). */
  session?: boolean;
  /** An API origin: `/api/**` is answered by it instead of the fakes (the live check below). */
  live?: string | undefined;
};

/** A page with the fake API; `posts` collects every POST body by path, `csp` every CSP violation. */
async function open({
  width = 1440,
  height = 900,
  scheme = 'light',
  session = false,
  live,
}: Options = {}) {
  if (!browser) throw new Error('browser did not start');
  const context = await browser.newContext({
    viewport: { width, height },
    colorScheme: scheme,
    locale: 'de-DE',
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const posts = new Map<string, unknown>();
  /** The headers of every POST by path. */
  const postHeaders = new Map<string, Record<string, string>>();
  /** The query string of every set page request. */
  const queries: string[] = [];
  const csp: string[] = [];
  let signedIn = session;
  page.on('console', (m) => {
    if (m.text().includes('Content Security Policy')) csp.push(m.text());
  });
  if (live) {
    // The browser keeps talking to its own origin; the Worker's job (the proxy) is done here.
    await page.route('**/api/**', async (route) => {
      const { pathname, search } = new URL(route.request().url());
      await route.fulfill({ response: await route.fetch({ url: live + pathname + search }) });
    });
    return { context, page, posts, postHeaders, csp, queries };
  }
  await page.route('https://img.voidbinder.de/**', (route) =>
    route.fulfill({ body: png, contentType: 'image/png' }),
  );
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (req.method() === 'POST') {
      posts.set(path, req.postDataJSON());
      postHeaders.set(path, req.headers());
    }
    if (path === '/api/auth/sign-up/email') {
      return route.fulfill({ json: { token: null, user: { id: 'u2' } } });
    }
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
    if (path === '/api/auth/get-session') {
      return route.fulfill({
        json: { session: { id: 's' }, user: { ...me, twoFactorEnabled: false } },
      });
    }
    if (path === '/api/auth/two-factor/enable') return route.fulfill({ json: twoFactorSetup });
    if (path === '/api/auth/two-factor/verify-totp') {
      return route.fulfill({ json: { token: 't', user: me } });
    }
    if (path === '/api/catalog/games') return route.fulfill({ json: games });
    const collection = collectionApi[path.replace('/api/collection/', '')];
    if (collection) return route.fulfill({ json: collection });
    if (path === '/api/decks') return route.fulfill({ json: decksList });
    if (path === `/api/decks/${DECK}`) return route.fulfill({ json: deck });
    if (path === '/api/catalog/games/mtg/sets') return route.fulfill({ json: mtgSets });
    if (path === '/api/catalog/sets/mtg/mid') {
      const url = new URL(req.url());
      queries.push(url.search);
      return route.fulfill({ json: mid(url.searchParams.get('rarity')) });
    }
    if (path === '/api/catalog/search') return route.fulfill({ json: search });
    if (path === `/api/catalog/cards/${CARD}`) return route.fulfill({ json: card });
    return route.fulfill({
      status: 404,
      json: { error: { code: 'not_found', message: 'x', requestId: 'r' } },
    });
  });
  return { context, page, posts, postHeaders, csp, queries };
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

  // Cloudflare's script is replaced by a stub (the test needs no network): this checks the build's
  // side, i.e. the CSP lets the script in, the sitekey of the build reaches render(), the box is
  // reserved before the widget is there and the token goes to the API.
  it('renders the Turnstile widget on sign-up without a layout shift and sends its token', async () => {
    const { context, page, postHeaders, csp } = await open();
    const sitekey = process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY || '1x00000000000000000000AA';
    let release = () => {};
    const released = new Promise<void>((resolve) => (release = resolve));
    await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js*', async (route) => {
      await released;
      await route.fulfill({
        contentType: 'text/javascript',
        body: `window.turnstile = {
          render(el, o) {
            const widget = document.createElement('div');
            widget.style.cssText = 'width:300px;height:65px';
            widget.dataset.sitekey = o.sitekey;
            widget.dataset.size = o.size;
            el.append(widget);
            setTimeout(() => o.callback('XXXX.DUMMY.TOKEN.XXXX'), 50);
            return 'w1';
          },
          reset() {},
          remove() {},
        };`,
      });
    });
    try {
      await page.goto(`${origin}/sign-up`);
      const box = page.getByRole('group', { name: 'Sicherheitsprüfung' });
      await box.waitFor();
      const before = await box.boundingBox();
      release();
      await page.locator(`[data-sitekey="${sitekey}"]`).waitFor();
      const after = await box.boundingBox();
      expect(before?.height).toBe(65);
      expect(after?.height).toBe(65);
      expect(after?.y).toBe(before?.y);
      expect(await axe(page)).toEqual([]);

      await page.getByLabel('Name').fill('Ada Lovelace');
      await page.getByLabel('E-Mail-Adresse').fill('ada@example.test');
      await page.getByLabel('Passwort').fill('correct horse battery');
      await page.getByRole('checkbox').first().click();
      await page.getByRole('button', { name: 'Konto erstellen' }).click();
      await page.getByText(/Wir haben einen Link an ada@example.test geschickt/).waitFor();
      expect(postHeaders.get('/api/auth/sign-up/email')?.['cf-turnstile-response']).toBe(
        'XXXX.DUMMY.TOKEN.XXXX',
      );
      expect(csp).toEqual([]);
    } finally {
      await context.close();
    }
  });

  // A 300 px widget does not fit the sign-up panel of a 360 px phone: Turnstile's compact size.
  it('asks for the compact Turnstile widget on a narrow phone and reserves its height', async () => {
    const { context, page } = await open({ width: 360, height: 740 });
    await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js*', (route) =>
      route.fulfill({
        contentType: 'text/javascript',
        body: `window.turnstile = {
          render(el, o) {
            const widget = document.createElement('div');
            widget.style.cssText = 'width:150px;height:140px';
            widget.dataset.size = o.size;
            el.append(widget);
            return 'w1';
          },
          reset() {},
          remove() {},
        };`,
      }),
    );
    try {
      await page.goto(`${origin}/sign-up`);
      const box = page.getByRole('group', { name: 'Sicherheitsprüfung' });
      await page.locator('[data-size="compact"]').waitFor();
      expect((await box.boundingBox())?.height).toBe(140);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        360,
      );
    } finally {
      await context.close();
    }
  });

  it('keeps the set page filters in the URL and survives a reload', async () => {
    const { context, page, queries, csp } = await open();
    try {
      await page.goto(`${origin}/mtg/sets/mid`);
      await page.getByRole('heading', { level: 1, name: 'Innistrad: Midnight Hunt' }).waitFor();
      await page.getByText('130 Karten, Seite 1').waitFor();
      expect(queries.at(-1)).toBe('?lang=de&sort=number&page=1&currency=EUR');
      // The card with a picture loads it from the image host without a CSP violation.
      await page.getByRole('img', { name: 'Adeline 1, MID 1' }).waitFor();
      await page.getByRole('button', { name: /Selten/ }).click();
      await page.waitForURL(/\/mtg\/sets\/mid\?rarity=rare$/);
      await page.getByRole('button', { name: /Selten/, pressed: true }).waitFor();
      expect(queries.at(-1)).toBe('?lang=de&sort=number&page=1&rarity=rare&currency=EUR');
      await page.getByRole('radio', { name: 'Liste' }).click();
      await page.waitForURL(/rarity=rare&view=list$/);
      await page.reload();
      await page.getByRole('button', { name: /Selten/, pressed: true }).waitFor();
      expect(await page.getByRole('radio', { name: 'Liste', checked: true }).count()).toBe(1);
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

  it('lists the sets of a game and opens one, remembering it on the home page', async () => {
    const { context, page } = await open();
    try {
      await page.goto(`${origin}/mtg`);
      await page.getByText('3 Sets').waitFor();
      await page.getByLabel('Sets filtern').fill('crimson');
      await page.getByText('1 von 3 Sets').waitFor();
      await page.getByRole('link', { name: /Crimson Vow/ }).click();
      await page.waitForURL(/\/mtg\/sets\/vow$/);
      await page.goto(`${origin}/mtg/sets/mid`);
      await page.getByText('130 Karten, Seite 1').waitFor();
      await page.getByRole('link', { name: 'Voidbinder, zur Startseite' }).click();
      const recent = page.getByRole('region', { name: 'Zuletzt angesehen' });
      await recent.getByRole('link', { name: /Innistrad: Midnight Hunt/ }).waitFor();
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
      [
        '/',
        '/sign-in',
        '/two-factor',
        '/mtg',
        '/mtg/sets/mid',
        '/mtg/sets/mid?view=list',
        '/search?q=adeline',
        `/cards/${CARD}`,
      ].map((path) => [scheme, name, path, width, height] as const),
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

  it.each(
    (['light', 'dark'] as const).flatMap((scheme) =>
      (
        [
          [1440, 900],
          [390, 844],
        ] as const
      ).map(([width, height]) => [scheme, width, height] as const),
    ),
  )('axe: %s /collection at %i px has no violations', async (scheme, width, height) => {
    const { context, page, csp } = await open({ width, height, scheme, session: true });
    try {
      await page.goto(`${origin}/collection`);
      await page.getByText('Adeline, strahlende Katharerin').first().waitFor();
      await page.waitForLoadState('networkidle');
      expect(await axe(page)).toEqual([]);
      expect(csp).toEqual([]);
    } finally {
      await context.close();
    }
  });

  it.each(
    (['light', 'dark'] as const).flatMap((scheme) =>
      (
        [
          [1440, 900],
          [390, 844],
        ] as const
      ).flatMap(([width, height]) =>
        (['/decks', `/decks/${DECK}`] as const).map(
          (path) => [scheme, path, width, height] as const,
        ),
      ),
    ),
  )('axe: %s %s at %i px has no violations', async (scheme, path, width, height) => {
    const { context, page, csp } = await open({ width, height, scheme, session: true });
    try {
      await page.goto(origin + path);
      await page.getByText('Nebelwacht').first().waitFor();
      await page.waitForLoadState('networkidle');
      expect(await axe(page)).toEqual([]);
      expect(csp).toEqual([]);
    } finally {
      await context.close();
    }
  });

  // The add dialog (VB-80): a modal dialog on the card page, as a sheet on the phone.
  // `SHOTS=<dir>` also saves a screenshot of the open dialog.
  it.each(
    (['light', 'dark'] as const).flatMap((scheme) =>
      (
        [
          [1440, 900],
          [390, 844],
        ] as const
      ).map(([width, height]) => [scheme, width, height] as const),
    ),
  )('axe: %s card page add dialog at %i px, and it adds', async (scheme, width, height) => {
    const { context, page, posts, csp } = await open({ width, height, scheme, session: true });
    try {
      await page.goto(`${origin}/cards/${CARD}`);
      await page.getByRole('button', { name: '+ In Sammlung' }).click();
      const dialog = page.getByRole('dialog', { name: 'In die Sammlung legen' });
      await dialog.getByRole('radiogroup', { name: 'Sprache' }).waitFor();
      await page.waitForLoadState('networkidle');
      expect(await axe(page)).toEqual([]);
      if (process.env.SHOTS)
        await page.screenshot({ path: `${process.env.SHOTS}/add-dialog-${scheme}-${width}.png` });
      // Focus is in the dialog and stays there.
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
      await dialog.getByRole('radio', { name: 'EN' }).click();
      await dialog.getByRole('radio', { name: 'Foil' }).click();
      await dialog.getByRole('radio', { name: 'EX' }).click();
      await dialog.getByRole('button', { name: 'Hinzufügen' }).click();
      await dialog.waitFor({ state: 'detached' });
      expect(posts.get('/api/collection/entries')).toEqual([
        expect.objectContaining({ language: 'en', finish: 'foil', condition: 'EX', quantity: 1 }),
      ]);
      expect(csp).toEqual([]);
    } finally {
      await context.close();
    }
  });

  // The quick add under the tiles (VB-80): set page and search signed in, the toast and its
  // "Ändern", which opens the dialog for the entry just added.
  it.each([
    [1440, 900],
    [390, 844],
  ] as const)('axe: quick add, toast and change dialog at %i px', async (width, height) => {
    const { context, page, posts, csp } = await open({ width, height, session: true });
    const shot = (name: string) =>
      process.env.SHOTS
        ? page.screenshot({ path: `${process.env.SHOTS}/${name}-${width}.png` })
        : undefined;
    try {
      await page.goto(`${origin}/mtg/sets/mid`);
      await page.getByRole('button', { name: 'In Sammlung: Adeline 1, MID 1' }).waitFor();
      await page.waitForLoadState('networkidle');
      expect(await axe(page)).toEqual([]);
      await shot('set-quick-add');
      await page.goto(`${origin}/search?q=adeline`);
      await page.getByRole('button', { name: /^In Sammlung: Adeline/ }).click();
      await page.getByText('Als DE · Normal · NM hinzugefügt').waitFor();
      expect(posts.get('/api/collection/entries')).toEqual([
        expect.objectContaining({ language: 'de', finish: 'normal', condition: 'NM' }),
      ]);
      expect(await axe(page)).toEqual([]);
      await shot('search-toast');
      await page.getByRole('button', { name: 'Ändern' }).click();
      const dialog = page.getByRole('dialog', { name: 'Hinzugefügte Karte ändern' });
      await dialog.getByRole('radiogroup', { name: 'Sprache' }).waitFor();
      expect(await axe(page)).toEqual([]);
      expect(csp).toEqual([]);
    } finally {
      await context.close();
    }
  });

  // The profile's 2FA section (VB-68) in its setup step (QR code, key) and with the backup codes.
  // `SHOTS=<dir>` also saves screenshots of the section and the challenge screen.
  it.each(
    (['light', 'dark'] as const).flatMap((scheme) =>
      (
        [
          [1440, 900],
          [390, 844],
        ] as const
      ).map(([width, height]) => [scheme, width, height] as const),
    ),
  )('axe: %s profile 2FA setup at %i px has no violations', async (scheme, width, height) => {
    const { context, page, csp } = await open({ width, height, scheme, session: true });
    const shots = process.env.SHOTS;
    const shot = async (name: string) => {
      if (shots)
        await page.screenshot({ path: `${shots}/${name}-${scheme}-${width}.png`, fullPage: true });
    };
    try {
      await page.goto(`${origin}/profile`);
      const section = page.getByRole('heading', {
        level: 2,
        name: 'Zwei-Faktor-Authentifizierung',
      });
      await section.waitFor();
      await page.getByText('Aus', { exact: true }).waitFor();
      await section.evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await shot('profile-2fa-off');
      await page.getByLabel('Passwort zur Bestätigung').fill('correct horse battery');
      await page.getByRole('button', { name: 'Einrichten' }).click();
      await page.getByRole('img', { name: 'QR-Code für die Authenticator-App' }).waitFor();
      await shot('profile-2fa-setup');
      expect(await axe(page)).toEqual([]);
      await page.getByLabel('Code aus der App').fill('123456');
      await page.getByRole('button', { name: 'Aktivieren' }).click();
      await page.getByText('K0X7Q-M2P4R').waitFor();
      await shot('profile-2fa-codes');
      expect(await axe(page)).toEqual([]);
      expect(csp).toEqual([]);
      if (shots) {
        await page.goto(`${origin}/two-factor`);
        await page.getByRole('button', { name: 'Bestätigen' }).waitFor();
        await shot('two-factor-challenge');
      }
    } finally {
      await context.close();
    }
  });
});

// The same build against the real dev API: `LIVE_API=https://voidbinder-app-dev.frisson.workers.dev
// pnpm --filter app exec vitest run --project web live` (`SHOTS=<dir>` also saves the screenshots).
describe.skipIf(!process.env.LIVE_API)('card prices against the dev API', () => {
  const live = process.env.LIVE_API;
  const shots = process.env.SHOTS;

  it('shows real prices on the search hit and the card page, at 1440 and 390', async () => {
    for (const width of [1440, 390]) {
      const { context, page } = await open({ width, height: 1000, live });
      try {
        await page.goto(`${origin}/search?q=adeline&game=mtg&set=mid`);
        // The hit carries the market price and its source.
        const hit = page.getByRole('link', { name: /^Adeline.*MID 1$/ });
        await hit.waitFor();
        await hit.getByText(/\d+,\d\d\s€/).waitFor();
        await hit.getByText('Cardmarket').waitFor();
        if (shots) await page.screenshot({ path: `${shots}/search-prices-${width}.png` });
        await hit.click();
        await page.getByRole('heading', { level: 2, name: 'Preise' }).waitFor();
        // Both sources, the observed date and the estimates of EX and GD.
        await page
          .getByText(/^Cardmarket \(via Scryfall\) · Normal · Near Mint · Stand \d\d\.\d\d\.\d{4}/)
          .waitFor();
        await page.getByText(/^TCGplayer \(via TCGCSV\) · Normal · Near Mint · Stand/).waitFor();
        const row = page.getByRole('group', { name: 'Zustand' });
        await row
          .getByText(/^≈ \d+,\d\d\s€/)
          .first()
          .waitFor();
        expect(await row.getByText(/^(NM|EX|GD)$/).count()).toBe(3);
        await page.getByRole('heading', { level: 3, name: /^Verlauf/ }).waitFor();
        if (shots) {
          await page
            .getByRole('heading', { level: 2, name: 'Preise' })
            .evaluate((el) => el.scrollIntoView({ block: 'start' }));
          await page.screenshot({ path: `${shots}/card-prices-${width}.png` });
        }
      } finally {
        // Requests still in flight would reject once the context is gone.
        await page.unrouteAll({ behavior: 'ignoreErrors' });
        await context.close();
      }
    }
  });
});
