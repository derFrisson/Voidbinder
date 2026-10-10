import { mkdir, readdir, readFile, appendFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { Resvg } from '@resvg/resvg-js';
import type { AstroIntegration } from 'astro';
import satori from 'satori';
import { securityHeaders } from '../security-headers';
import { ogImagePath, ogImageSize } from '../seo';

/**
 * Build-time SEO assets, written into the static client output after `astro build`:
 * - one 1200×630 Open Graph PNG per built HTML page, from that page's og:title / og:description
 *   (static assets under /og/, never rendered per request);
 * - the security headers appended to `_headers` for every static asset (prod adds HSTS, chosen by
 *   CLOUDFLARE_ENV like the rest of the deploy config; PLAUSIBLE_HOST joins the CSP).
 */
export function seo(): AstroIntegration {
  let client: URL;
  let server: URL;
  return {
    name: 'voidbinder:seo',
    hooks: {
      'astro:config:done': ({ config }) => {
        client = config.build.client;
        server = config.build.server;
      },
      'astro:build:done': async ({ logger }) => {
        const fonts = await loadFonts();
        const pages = (await readdir(client, { recursive: true })).filter((f) =>
          f.endsWith('.html'),
        );
        for (const file of pages) {
          const html = await readFile(new URL(file, client), 'utf8');
          const png = await renderOgImage(
            meta(html, 'og:title'),
            meta(html, 'og:description'),
            fonts,
          );
          const out = new URL(`.${ogImagePath(file)}`, client);
          await mkdir(new URL('.', out), { recursive: true });
          await writeFile(out, png);
        }
        logger.info(`${pages.length} Open Graph images written to /og/`);

        // The build's environment, flattened by the adapter, is where PLAUSIBLE_HOST lives.
        const { vars } = JSON.parse(await readFile(new URL('wrangler.json', server), 'utf8')) as {
          vars?: { PLAUSIBLE_HOST?: string };
        };
        const headers = securityHeaders(
          process.env.CLOUDFLARE_ENV === 'prod',
          vars?.PLAUSIBLE_HOST,
        );
        const rule = Object.entries(headers).map(([name, value]) => `  ${name}: ${value}`);
        await appendFile(new URL('_headers', client), `\n/*\n${rule.join('\n')}\n`);
      },
    },
  };
}

function meta(html: string, property: string): string {
  const match = new RegExp(`<meta property="${property}" content="([^"]*)"`).exec(html);
  if (!match?.[1]) throw new Error(`built page without ${property}`);
  return match[1]
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

async function loadFonts() {
  const require = createRequire(import.meta.url);
  // Satori reads TTF/OTF/WOFF, not WOFF2, so the OG images use Fontsource's WOFF builds of the
  // site fonts: Sora for the title, Public Sans for the rest.
  const load = (family: string, weight: number) =>
    readFile(require.resolve(`@fontsource/${family}/files/${family}-latin-${weight}-normal.woff`));
  return [
    { name: 'Sora', data: await load('sora', 700), weight: 700 as const, style: 'normal' as const },
    {
      name: 'Public Sans',
      data: await load('public-sans', 400),
      weight: 400 as const,
      style: 'normal' as const,
    },
    {
      name: 'Public Sans',
      data: await load('public-sans', 600),
      weight: 600 as const,
      style: 'normal' as const,
    },
  ];
}

// Brand tokens from src/styles/global.css, light theme (satori has no CSS variables).
const bg = '#F4F6FB';
const ink = '#0B1433';
const ink2 = '#4B5577';
const blue = '#1E48F5';
const fields = { pk: '#FFD447', yg: '#9A7CF0', mg: '#FF8F45', op: '#F0544A' };

type Node = { type: string; props: { style?: Record<string, unknown>; children?: unknown } };
const div = (style: Record<string, unknown>, children?: unknown): Node => ({
  type: 'div',
  props: { style: { display: 'flex', ...style }, children },
});

/** A soft colour field of the hero, absolutely placed. */
const field = (color: string, style: Record<string, unknown>): Node =>
  div({ position: 'absolute', background: color, borderRadius: 36, ...style });

/** The invented example card as plain shapes: yellow frame, sky art window, text box. No art. */
function card(): Node {
  return div(
    {
      position: 'absolute',
      left: 96,
      top: 118,
      width: 220,
      height: 307,
      padding: 10,
      borderRadius: 14,
      background: '#F2B705',
      transform: 'rotate(-5deg)',
      boxShadow: '0 24px 40px -18px rgba(11, 20, 51, 0.55)',
    },
    [
      div(
        {
          flexDirection: 'column',
          flexGrow: 1,
          gap: 9,
          padding: 9,
          borderRadius: 8,
          background: '#FFF8DB',
        },
        [
          div({ width: 120, height: 12, borderRadius: 3, background: '#2B2100' }),
          div({
            height: 128,
            borderRadius: 4,
            background: 'linear-gradient(180deg, #9ED8FF, #E4F6FF 70%, #9EDB8F 70%)',
            border: '4px solid #D99A00',
          }),
          div({ height: 16, borderRadius: 3, background: '#FFE58C' }),
          div({ flexGrow: 1, borderRadius: 4, background: '#FFF1BE' }),
        ],
      ),
    ],
  );
}

async function renderOgImage(
  title: string,
  description: string,
  fonts: Awaited<ReturnType<typeof loadFonts>>,
): Promise<Buffer> {
  const heading = title.replace(/^Voidbinder · /, '').replace(/ · Voidbinder$/, '');
  const tree = div(
    {
      width: '100%',
      height: '100%',
      background: bg,
      color: ink,
      fontFamily: 'Public Sans',
      padding: 72,
    },
    [
      div({ flexDirection: 'column', width: 680, justifyContent: 'space-between' }, [
        div({ alignItems: 'center', gap: 16 }, [
          div({ position: 'relative', width: 46, height: 46 }, [
            div({
              position: 'absolute',
              left: 4,
              top: 9,
              width: 28,
              height: 34,
              borderRadius: 6,
              background: blue,
            }),
            div({
              position: 'absolute',
              left: 20,
              top: 2,
              width: 21,
              height: 28,
              borderRadius: 4,
              background: fields.pk,
              border: `2.5px solid ${ink}`,
              transform: 'rotate(12deg)',
            }),
          ]),
          div(
            { fontFamily: 'Sora', fontSize: 34, fontWeight: 700, letterSpacing: '-0.035em' },
            'Voidbinder',
          ),
        ]),
        div({ flexDirection: 'column', gap: 22 }, [
          div(
            {
              fontFamily: 'Sora',
              fontSize: 62,
              fontWeight: 700,
              lineHeight: 1.02,
              letterSpacing: '-0.045em',
            },
            heading,
          ),
          div({ fontSize: 25, lineHeight: 1.45, color: ink2 }, description),
        ]),
        div({ alignItems: 'center', gap: 12, fontSize: 18, fontWeight: 600, color: ink2 }, [
          div({ width: 12, height: 12, borderRadius: 3, background: blue }),
          'voidbinder.de · Pre-alpha',
        ]),
      ]),
      div({ position: 'relative', flexGrow: 1 }, [
        field(fields.pk, {
          left: 10,
          top: 40,
          width: 230,
          height: 230,
          transform: 'rotate(-4deg)',
        }),
        field(fields.yg, { right: -20, top: 0, width: 170, height: 200 }),
        field(fields.mg, {
          left: 40,
          bottom: 20,
          width: 200,
          height: 190,
          transform: 'rotate(3deg)',
        }),
        field(fields.op, { right: 0, bottom: 50, width: 150, height: 150, borderRadius: 75 }),
        card(),
      ]),
    ],
  );
  const svg = await satori(tree as Parameters<typeof satori>[0], { ...ogImageSize, fonts });
  return new Resvg(svg, { fitTo: { mode: 'width', value: ogImageSize.width } }).render().asPng();
}
