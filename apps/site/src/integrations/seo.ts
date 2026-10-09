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
 *   CLOUDFLARE_ENV like the rest of the deploy config).
 */
export function seo(): AstroIntegration {
  let client: URL;
  return {
    name: 'voidbinder:seo',
    hooks: {
      'astro:config:done': ({ config }) => {
        client = config.build.client;
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

        const headers = securityHeaders(process.env.CLOUDFLARE_ENV === 'prod');
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
  // Satori reads TTF/OTF/WOFF, not WOFF2, so the OG images use Fontsource's WOFF build of Inter.
  const load = (weight: 400 | 500) =>
    readFile(require.resolve(`@fontsource/inter/files/inter-latin-${weight}-normal.woff`));
  return [
    { name: 'Inter', data: await load(400), weight: 400 as const, style: 'normal' as const },
    { name: 'Inter', data: await load(500), weight: 500 as const, style: 'normal' as const },
  ];
}

// Brand tokens from src/styles/global.css (satori has no CSS variables).
const bg = '#080808';
const text = '#f4f4f2';
const muted = 'rgba(244, 244, 242, 0.64)';
const edge = 'rgba(244, 244, 242, 0.14)';
const pink = '#f5b4be';
const pinkFaint = 'rgba(245, 180, 190, 0.12)';

type Node = { type: string; props: { style?: Record<string, unknown>; children?: unknown } };
const div = (style: Record<string, unknown>, children?: unknown): Node => ({
  type: 'div',
  props: { style: { display: 'flex', ...style }, children },
});

/** An empty 63:88 card: hairline frame, name bar, art window, text lines. Never artwork. */
function card(rotate: number, left: number, accent: boolean): Node {
  const line = accent ? pink : edge;
  return div(
    {
      position: 'absolute',
      left,
      top: 40,
      width: 252,
      height: 352,
      flexDirection: 'column',
      padding: 22,
      gap: 14,
      border: `2px solid ${line}`,
      borderRadius: 6,
      background: accent ? pinkFaint : bg,
      transform: `rotate(${rotate}deg)`,
    },
    [
      div({ width: 120, height: 4, background: line }),
      div({ height: 136, border: `2px solid ${line}`, borderRadius: 2 }),
      div({ width: 200, height: 4, background: line }),
      div({ width: 168, height: 4, background: line }),
      div({ width: 120, height: 4, background: line }),
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
      color: text,
      fontFamily: 'Inter',
      padding: 72,
    },
    [
      div({ flexDirection: 'column', width: 690, justifyContent: 'space-between' }, [
        div({ alignItems: 'center', gap: 16 }, [
          div({ position: 'relative', width: 44, height: 44, background: pink, borderRadius: 4 }, [
            div({
              position: 'absolute',
              left: 13,
              top: 8,
              width: 18,
              height: 26,
              background: bg,
              borderRadius: 2,
            }),
          ]),
          div({ fontSize: 32, fontWeight: 500, letterSpacing: '-0.02em' }, 'Voidbinder'),
        ]),
        div({ flexDirection: 'column', gap: 24 }, [
          div(
            { fontSize: 60, fontWeight: 500, lineHeight: 1.08, letterSpacing: '-0.025em' },
            heading,
          ),
          div({ fontSize: 24, lineHeight: 1.45, color: muted }, description),
        ]),
        div(
          { fontSize: 16, letterSpacing: '0.12em', color: muted, textTransform: 'uppercase' },
          'voidbinder.de · Pre-alpha',
        ),
      ]),
      div({ position: 'relative', flexGrow: 1 }, [
        card(-14, 60, false),
        card(-4, 140, false),
        card(8, 220, true),
      ]),
    ],
  );
  const svg = await satori(tree as Parameters<typeof satori>[0], { ...ogImageSize, fonts });
  return new Resvg(svg, { fitTo: { mode: 'width', value: ogImageSize.width } }).render().asPng();
}
