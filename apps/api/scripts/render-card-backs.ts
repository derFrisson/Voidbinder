// Card backs as the placeholder image (VB-120, drawn by us since VB-122): one back per game, all
// four in one construction, rendered from SVG. No game's official back, no download: the colour
// is the game's field from @voidbinder/tokens, the rest is geometry. Writes WebP into a local
// folder for R2 (`images/backs/<game>/{orig,sm}.webp`) and the bundled copy of the app
// (apps/app/assets/backs/<game>.webp, the `sm` rendition). Uploads nothing: it prints the
// `wrangler r2 object put` commands for the orchestrator.
//
//   pnpm --filter api render-card-backs --out /path/to/folder
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { CARD_FORMATS, GameSchema, type Game } from '@voidbinder/shared';
import { tokens } from '@voidbinder/tokens';
import sharp from 'sharp';
import { SM_WIDTH } from '../src/import/images';

const ORIG_WIDTH = 1000;

/** `hex` moved towards `into` by `t` (0 to 1): black keeps the hue, the field only deepens. */
function mix(hex: string, into: string, t: number): string {
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [a, b] = [rgb(hex), rgb(into)];
  return `#${a
    .map((v, i) =>
      Math.round(v + ((b[i] as number) - v) * t)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/**
 * One guilloche band: `strands` closed curves r(θ) = radius + amp·sin(lobes·θ + phase), each
 * strand a fraction of a lobe further round, so they weave. `sy` stretches the band vertically
 * to follow the portrait card.
 */
function band(
  cx: number,
  cy: number,
  radius: number,
  amp: number,
  lobes: number,
  strands: number,
  sy = 1,
): string {
  const steps = lobes * 24;
  let d = '';
  for (let k = 0; k < strands; k++) {
    const phase = (k / strands) * Math.PI * 2;
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * Math.PI * 2;
      const r = radius + amp * Math.sin(lobes * t + phase);
      d += `${i ? 'L' : 'M'}${(cx + r * Math.cos(t)).toFixed(1)} ${(cy + r * Math.sin(t) * sy).toFixed(1)}`;
    }
    d += 'Z';
  }
  return d;
}

/** The game's monogram, drawn as strokes in a box of half-height 1 around the origin. */
const MONOGRAM: Record<Game, string> = {
  pokemon: 'M-0.26 1V-1H0.04A0.5 0.5 0 0 1 0.04 0H-0.26',
  yugioh: 'M-0.56 -1L0 -0.08L0.56 -1M0 -0.08V1',
  mtg: 'M-0.62 1V-1L0 0.12L0.62 -1V1',
  onepiece: 'M0 -1A0.66 1 0 1 1 0 1A0.66 1 0 1 1 0 -1Z',
};

const FIELD = { pokemon: 'pk', yugioh: 'yg', mtg: 'mg', onepiece: 'op' } as const;

/** The back of `game` as SVG, `width` px wide, in the game's card format. */
function backSvg(game: Game, width = ORIG_WIDTH): string {
  const format = CARD_FORMATS[game === 'yugioh' ? 'japanese' : 'standard'];
  const W = width;
  const H = Math.round((width * format.height) / format.width);
  const u = W / 1000; // every length below is in thousandths of the width
  const [cx, cy] = [W / 2, H / 2];
  const field = tokens.color.light[FIELD[game]];
  const ink = tokens.color.light.ink;
  const deep = mix(field, '#000000', 0.12);
  const radius = 46 * u; // a printed card's 3 mm corner
  const rim = 38 * u;
  const frame = 64 * u;
  const medal = 132 * u;
  const n = (v: number) => v.toFixed(1);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="base" cx="50%" cy="50%" r="62%" gradientTransform="translate(0.5 0.5) scale(1 ${n(W / H)}) translate(-0.5 -0.5)">
      <stop offset="0.3" stop-color="${field}"/>
      <stop offset="1" stop-color="${deep}"/>
    </radialGradient>
    <clipPath id="card"><rect width="${W}" height="${H}" rx="${n(radius)}"/></clipPath>
    <clipPath id="inner"><rect x="${n(rim)}" y="${n(rim)}" width="${n(W - 2 * rim)}" height="${n(H - 2 * rim)}" rx="${n(radius - rim / 2)}"/></clipPath>
    <pattern id="dots" width="${n(28 * u)}" height="${n(28 * u)}" patternUnits="userSpaceOnUse">
      <circle cx="${n(14 * u)}" cy="${n(14 * u)}" r="${n(2.4 * u)}" fill="#fff"/>
    </pattern>
  </defs>
  <g clip-path="url(#card)">
    <rect width="${W}" height="${H}" fill="${ink}"/>
    <g clip-path="url(#inner)">
      <rect width="${W}" height="${H}" fill="url(#base)"/>
      <rect width="${W}" height="${H}" fill="url(#dots)" opacity="0.16"/>
      <g fill="none" stroke="#fff" stroke-width="${n(2.2 * u)}">
        <path d="${band(cx, cy, 440 * u, 90 * u, 12, 6, 1.36)}" stroke-opacity="0.2"/>
        <path d="${band(cx, cy, 228 * u, 34 * u, 24, 5)}" stroke-opacity="0.34"/>
      </g>
    </g>
    <rect x="${n(frame)}" y="${n(frame)}" width="${n(W - 2 * frame)}" height="${n(H - 2 * frame)}" rx="${n(radius - frame / 2)}" fill="none" stroke="#fff" stroke-opacity="0.72" stroke-width="${n(4 * u)}"/>
    <rect x="${n(frame + 14 * u)}" y="${n(frame + 14 * u)}" width="${n(W - 2 * frame - 28 * u)}" height="${n(H - 2 * frame - 28 * u)}" rx="${n(radius - frame / 2 - 8 * u)}" fill="none" stroke="#fff" stroke-opacity="0.4" stroke-width="${n(1.6 * u)}"/>
  </g>
  <circle cx="${cx}" cy="${cy}" r="${n(medal + 18 * u)}" fill="none" stroke="#fff" stroke-opacity="0.8" stroke-width="${n(3 * u)}"/>
  <circle cx="${cx}" cy="${cy}" r="${n(medal)}" fill="${ink}"/>
  <circle cx="${cx}" cy="${cy}" r="${n(medal - 14 * u)}" fill="none" stroke="${field}" stroke-opacity="0.45" stroke-width="${n(2 * u)}"/>
  <path d="${MONOGRAM[game]}" transform="translate(${cx} ${cy}) scale(${n(62 * u)})" fill="none" stroke="${field}" stroke-width="${(22 / 62).toFixed(3)}" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
}

const { values: args } = parseArgs({ options: { out: { type: 'string' } } });
if (!args.out) throw new Error('--out <folder> is required');
const out = resolve(args.out);
const bundled = resolve(import.meta.dirname, '../../app/assets/backs');
const bucket = process.env.R2_BUCKET ?? 'voidbinder-catalog';
// ponytail: a week, not the fronts' immutable year: a back may still be redrawn.
const CACHE_CONTROL = 'public, max-age=604800';

await mkdir(bundled, { recursive: true });
const commands: string[] = [];
for (const game of GameSchema.options) {
  const orig = await sharp(Buffer.from(backSvg(game)))
    .webp({ quality: 90 })
    .toBuffer();
  // Drawn again at the small width rather than scaled down, so the hairlines stay crisp.
  const sm = await sharp(Buffer.from(backSvg(game, SM_WIDTH)))
    .webp({ quality: 88 })
    .toBuffer();
  const dir = join(out, 'images/backs', game);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'orig.webp'), orig);
  await writeFile(join(dir, 'sm.webp'), sm);
  await writeFile(join(bundled, `${game}.webp`), sm);
  console.log(`${game}: orig ${orig.length} B, sm ${sm.length} B`);
  for (const size of ['orig', 'sm'])
    commands.push(
      `pnpm --filter api exec wrangler r2 object put ${bucket}/images/backs/${game}/${size}.webp --remote --file ${join(dir, `${size}.webp`)} --content-type image/webp --cache-control '${CACHE_CONTROL}'`,
    );
}
console.log(`\nUpload to R2:\n${commands.join('\n')}`);
