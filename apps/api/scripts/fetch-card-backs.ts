// Card backs as the placeholder image (VB-120): one back per game, from the same sources as the
// fronts, written as WebP into a local folder for R2 (`images/backs/<game>/{orig,sm}.webp`) and as
// the bundled copy of the app (apps/app/assets/backs/<game>.webp, the `sm` rendition). Uploads
// nothing: it prints the `wrangler r2 object put` commands for the orchestrator.
//
//   pnpm --filter api fetch-card-backs --out /path/to/folder
//
// One Piece has no image source yet (`sourceUrl` answers null), so it gets a stylized back in its
// colour field from @voidbinder/tokens.
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { CARD_FORMATS, type Game } from '@voidbinder/shared';
import { tokens } from '@voidbinder/tokens';
import sharp from 'sharp';
import { SM_WIDTH } from '../src/import/images';
import { USER_AGENT } from '../src/import/scryfall/source';
import { USER_AGENT as YUGIPEDIA_USER_AGENT } from '../src/import/yugipedia/source';

const { values: args } = parseArgs({ options: { out: { type: 'string' } } });
if (!args.out) throw new Error('--out <folder> is required');
const out = resolve(args.out);
const bundled = resolve(import.meta.dirname, '../../app/assets/backs');
const bucket = process.env.R2_BUCKET ?? 'voidbinder-catalog';
// ponytail: a week, not the fronts' immutable year: a back may still be replaced (One Piece).
const CACHE_CONTROL = 'public, max-age=604800';

async function get(url: string, userAgent = USER_AGENT): Promise<Response> {
  const res = await fetch(url, { headers: { 'User-Agent': userAgent } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res;
}

/** A MediaWiki file's current URL (Yugipedia, Bulbagarden Archives): one imageinfo request. */
async function wikiFile(api: string, title: string, userAgent?: string): Promise<string> {
  const q = new URLSearchParams({
    action: 'query',
    titles: title,
    prop: 'imageinfo',
    iiprop: 'url',
    format: 'json',
  });
  const body = (await (await get(`${api}?${q}`, userAgent)).json()) as {
    query: { pages: Record<string, { imageinfo?: { url: string }[] }> };
  };
  const url = Object.values(body.query.pages)[0]?.imageinfo?.[0]?.url;
  if (!url) throw new Error(`${title} not found at ${api}`);
  return url;
}

/** A neutral back in the game's colour, in its card format, as SVG. */
function drawnBack(game: Game): Buffer {
  const { width, height } = CARD_FORMATS[game === 'yugioh' ? 'japanese' : 'standard'];
  const [w, h] = [width * 10, height * 10];
  const key = { pokemon: 'pk', yugioh: 'yg', mtg: 'mg', onepiece: 'op' } as const;
  const fill = tokens.color.light[key[game]];
  const ink = tokens.color.light.ink;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <rect width="${w}" height="${h}" rx="30" fill="${ink}"/>
  <rect x="28" y="28" width="${w - 56}" height="${h - 56}" rx="18" fill="${fill}"/>
  <rect x="58" y="58" width="${w - 116}" height="${h - 116}" rx="10" fill="none" stroke="${ink}" stroke-opacity="0.35" stroke-width="6"/>
  <circle cx="${w / 2}" cy="${h / 2}" r="${w * 0.22}" fill="none" stroke="${ink}" stroke-opacity="0.35" stroke-width="10"/>
  <circle cx="${w / 2}" cy="${h / 2}" r="${w * 0.08}" fill="${ink}" fill-opacity="0.35"/>
</svg>`,
  );
}

const sources: Record<Game, () => Promise<{ from: string; body: Buffer }>> = {
  // Scryfall's default back: the `card_back_id` of every single-faced card, on backs.scryfall.io.
  mtg: async () => {
    const from = 'https://backs.scryfall.io/png/0/a/0aeebaf5-8c7d-4636-9e82-8c27447861f7.png';
    return { from, body: Buffer.from(await (await get(from)).arrayBuffer()) };
  },
  yugioh: async () => {
    const from = await wikiFile(
      'https://yugipedia.com/api.php',
      'File:Back-EN.png',
      YUGIPEDIA_USER_AGENT,
    );
    return { from, body: Buffer.from(await (await get(from, YUGIPEDIA_USER_AGENT)).arrayBuffer()) };
  },
  pokemon: async () => {
    const from = await wikiFile('https://archives.bulbagarden.net/w/api.php', 'File:Cardback.jpg');
    return { from, body: Buffer.from(await (await get(from)).arrayBuffer()) };
  },
  onepiece: async () => ({ from: 'drawn (tokens.color.light.op)', body: drawnBack('onepiece') }),
};

await mkdir(bundled, { recursive: true });
const commands: string[] = [];
for (const [game, source] of Object.entries(sources) as [Game, (typeof sources)[Game]][]) {
  const { from, body } = await source();
  const orig = await sharp(body).webp().toBuffer();
  const sm = await sharp(body)
    .resize({ width: SM_WIDTH, withoutEnlargement: true })
    .webp()
    .toBuffer();
  const dir = join(out, 'images/backs', game);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'orig.webp'), orig);
  await writeFile(join(dir, 'sm.webp'), sm);
  await writeFile(join(bundled, `${game}.webp`), sm);
  console.log(`${game}: ${from} -> orig ${orig.length} B, sm ${sm.length} B`);
  for (const size of ['orig', 'sm'])
    commands.push(
      `pnpm --filter api exec wrangler r2 object put ${bucket}/images/backs/${game}/${size}.webp --remote --file ${join(dir, `${size}.webp`)} --content-type image/webp --cache-control '${CACHE_CONTROL}'`,
    );
}
console.log(`\nUpload to R2:\n${commands.join('\n')}`);
