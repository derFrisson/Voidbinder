import AxeBuilder from '@axe-core/playwright';
import { spawn, type ChildProcess } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// WCAG 2.2 AA, automated (VB-20): axe-core in real Chromium over every HTML page of the build,
// served by the same Worker that ships (`wrangler dev`), so the on-demand status pages are included.
// Needs `pnpm exec playwright install chromium` once; runs after `astro build` (turbo).
const root = new URL('..', import.meta.url);
const client = new URL('dist/client/', root);

// Prerendered pages come from the build output, so a new page is covered without touching this file.
const prerendered = readdirSync(client, { recursive: true, encoding: 'utf8' })
  .filter((f) => f.endsWith('.html') && f !== '404.html')
  .map((f) => `/${f.replace(/index\.html$/, '')}`)
  .sort();
// On demand (src/pages/[locale]/waitlist/{error,unsubscribe}.astro), plus a path that is no page.
const onDemand = ['de', 'en'].flatMap((l) => [
  `/${l}/waitlist/error/?reason=email`,
  `/${l}/waitlist/error/?reason=consent`,
  `/${l}/waitlist/error/`,
  `/${l}/waitlist/unsubscribe/?token=abc`,
  `/${l}/waitlist/unsubscribe/`,
]);
const paths = [...prerendered, ...onDemand, '/en/no-such-page/', '/no-such-page/'];

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = createServer().once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });

let worker: ChildProcess | undefined;
let browser: Browser | undefined;
let origin = '';

async function open(width: number, height: number, colorScheme: 'light' | 'dark' = 'light') {
  if (!browser) throw new Error('browser did not start');
  // Reduced motion: axe checks the resting state (the hero's final frame) instead of a frame
  // caught mid-animation, which a busy CI runner reached and failed on contrast.
  const context = await browser.newContext({
    viewport: { width, height },
    colorScheme,
    reducedMotion: 'reduce',
  });
  return { context, page: await context.newPage() };
}

beforeAll(async () => {
  const port = await freePort();
  origin = `http://127.0.0.1:${port}`;
  // detached: the group is killed below, `pnpm exec` leaves wrangler and workerd as grandchildren.
  worker = spawn('pnpm', ['exec', 'wrangler', 'dev', '--port', String(port), '--ip', '127.0.0.1'], {
    cwd: root,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, UNSUBSCRIBE_SECRET: 'a11y-test-secret' },
  });
  for (let i = 0; ; i++) {
    const ok = await fetch(`${origin}/de/`).then(
      (r) => r.ok,
      () => false,
    );
    if (ok) break;
    if (i > 90) throw new Error('wrangler dev did not come up');
    await new Promise((r) => setTimeout(r, 1000));
  }
  browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
  await browser?.close();
  if (worker?.pid) process.kill(-worker.pid, 'SIGTERM');
});

describe('axe-core, WCAG 2.2 AA', () => {
  it('covers the landing pages, legal pages and status pages', () => {
    for (const p of ['/de/', '/en/', '/de/impressum/', '/en/privacy/', '/de/waitlist/pending/'])
      expect(paths).toContain(p);
  });

  // Desktop, and a phone width where the nav collapses and everything stacks.
  const viewports = [
    ['desktop', 1280, 800],
    ['phone', 390, 844],
  ] as const;
  // Both colour schemes: the dark tokens are separate values, so contrast has to hold in each.
  const cases = (['light', 'dark'] as const).flatMap((scheme) =>
    viewports.flatMap(([name, width, height]) =>
      paths.map((path) => [scheme, name, path, width, height] as const),
    ),
  );

  it.each(cases)(
    '%s %s %s has no violations',
    async (scheme, _name, path, width, height) => {
      const { context, page } = await open(width, height, scheme);
      try {
        await page.goto(origin + path);
        const { violations } = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
          .analyze();
        expect(
          violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
        ).toEqual([]);
      } finally {
        await context.close();
      }
    },
    30_000,
  );

  // WCAG 1.4.10: at 320 px the nav (logo, language switch, button) must not run past the edge;
  // html clips overflow, so a button pushed out of the viewport would be unreachable.
  it.each(['de', 'en'])('the /%s/ nav fits into 320 px', async (locale) => {
    const { context, page } = await open(320, 640);
    try {
      await page.goto(`${origin}/${locale}/`);
      const right = await page.locator('.nav-end').evaluate((e) => e.getBoundingClientRect().right);
      expect(right).toBeLessThanOrEqual(320);
    } finally {
      await context.close();
    }
  });
});
