import { failRun, finishRun } from '../scryfall/write';
import type { ImportDeps, StepRunner } from '../scryfall/pipeline';
import { log } from '../../middleware/log';
import { purgeEdgeCache } from '../util';
import { coverageCounts, groupsKey, priceCoverage, readGroups } from './coverage';
import { codeOf, isCard, matchGroups, matchProducts, rarityKey, type ProductMatch } from './match';
import {
  CATEGORIES,
  cents,
  extended,
  fetchRaw,
  finishOf,
  lastUpdated,
  results,
  type PricedGame,
  type TcgGroup,
  type TcgPrice,
  type TcgProduct,
} from './tcgcsv';
import {
  candidatePrints,
  gameSets,
  lastImportedUpdate,
  resolveMappings,
  setIdsByCode,
  startRun,
  upsertMappings,
  writePrices,
  type MappingRow,
  type PriceRow,
} from './write';

// The daily TCGCSV price import as named, retryable steps (the shape of the catalog imports):
// the Workflow (src/workflows/tcgcsv-import.ts) runs each through `step.do`, so a failed run
// resumes at the failed group range; tests pass a runner that just calls the function.

/** Groups per step: 50 requests and their writes, a few minutes at most. */
export const GROUPS_PER_STEP = 25;

export interface PriceImportOptions {
  /** `IMPORT_ENV`: raw answers go to `raw/<env>/tcgcsv/<date>/<category>/`. */
  env: string;
  /** UTC day of the run. */
  date: string;
  /** Pause before each request; TCGCSV asks for 100 ms. */
  delayMs?: number;
  games?: readonly PricedGame[];
  /**
   * Imports the build even when the last run did: re-runs the group and product matching, so a
   * new rule reaches the prices without a new build (VB-110, VB-111,
   * `POST /admin/import/tcgcsv?force=true`).
   */
  force?: boolean;
}

export interface GameStats {
  groups: number;
  matchedGroups: number;
  /** Products that are single cards (have a Number or Rarity). */
  cards: number;
  /** Card products with a mapped print. */
  mapped: number;
  unmapped: number;
  /** Price rows written (one per print, finish and source). */
  prices: number;
  /** Price rows without a market price (too few sales), not written. */
  noMarket: number;
}

const GAMES: readonly PricedGame[] = ['mtg', 'yugioh', 'pokemon'];
const SOURCE = 'tcgplayer';

/** The matched groups per set, in order of first appearance; each set's groups by group id. */
function groupsBySet(groups: readonly { groupId: number; setId: string }[]) {
  const out = new Map<string, number[]>();
  for (const g of groups) out.set(g.setId, [...(out.get(g.setId) ?? []), g.groupId]);
  for (const ids of out.values()) ids.sort((a, b) => a - b);
  return out;
}

/** Steps of about `GROUPS_PER_STEP` groups that never split a set (its groups match together). */
export function groupSteps(groups: readonly { groupId: number; setId: string }[]) {
  const steps: { groupId: number; setId: string }[][] = [];
  let current: { groupId: number; setId: string }[] = [];
  for (const [setId, ids] of groupsBySet(groups)) {
    if (current.length && current.length + ids.length > GROUPS_PER_STEP) {
      steps.push(current);
      current = [];
    }
    current.push(...ids.map((groupId) => ({ groupId, setId })));
  }
  if (current.length) steps.push(current);
  return steps;
}

/**
 * A set's products in group id order, without the reprints: a card that two groups of the set list
 * under one number and rarity is one print (VB-111: LOB's 25th Anniversary Edition, folded into
 * the set by the YGOPRODeck import). A group with a market price for it prices the print (VB-113:
 * the Worldwide English `MRD-EN010` has none, its 25th Anniversary reprint has); among those, and
 * failing a price, the group of the print's current product (`mapped`, product ids) first, so a
 * print keeps its product while that has a price; else the lowest group id. The other groups'
 * products are the reprints, left out of the matching.
 */
export function splitReprints(
  own: readonly { groupId: number; product: TcgProduct }[],
  prices: readonly TcgPrice[],
  mapped: ReadonlySet<number> = new Set(),
) {
  // ponytail: group id order stands in for TCGplayer's `publishedOn`; read that if they diverge.
  const priced = new Set(prices.flatMap((p) => (p.marketPrice == null ? [] : [p.productId])));
  const key = (p: TcgProduct) => {
    const number = extended(p, 'Number');
    return number && `${number}|${rarityKey(extended(p, 'Rarity') ?? '')}`;
  };
  // A price beats none, then the current mapping; a tie keeps the lower group (`own` is in order).
  const chosen = new Map<string, { groupId: number; rank: number }>();
  for (const { groupId, product } of own) {
    const k = key(product);
    if (!k) continue;
    const rank = (priced.has(product.productId) ? 2 : 0) + (mapped.has(product.productId) ? 1 : 0);
    if (rank > (chosen.get(k)?.rank ?? -1)) chosen.set(k, { groupId, rank });
  }
  const products: TcgProduct[] = [];
  const reprints: TcgProduct[] = [];
  for (const { groupId, product } of own) {
    const k = key(product);
    (k && chosen.get(k)?.groupId !== groupId ? reprints : products).push(product);
  }
  return { products, reprints };
}

/**
 * Imports the products and prices of a range of matched groups; returns their counts. The groups
 * of one set are matched together (VB-111: LOB's `LOB` group holds the North American prints, its
 * two `LOB-EN` groups the EN ones), so a print one group's product claims by number is taken for
 * another group's regional pass and the more confident claim wins. Yu-Gi-Oh! products may name
 * another set (VB-113: LC03's group lists Legendary Collection 3's mega pack, `LCYW-EN…`); the
 * prints of such a set are candidates too, unless the set has a group of its own (`grouped`).
 */
export async function importGroups(
  deps: ImportDeps,
  game: PricedGame,
  groups: { groupId: number; setId: string }[],
  opts: { raw: string; delayMs: number; observedAt: string; grouped?: ReadonlySet<string> },
) {
  const category = CATEGORIES[game];
  const byId = game === 'mtg';
  const stats = { cards: 0, mapped: 0, unmapped: 0, prices: 0, noMarket: 0 };
  for (const [setId, groupIds] of groupsBySet(groups)) {
    const own: { groupId: number; product: TcgProduct }[] = [];
    const prices: TcgPrice[] = [];
    for (const groupId of groupIds) {
      const fetchFile = (file: string) =>
        fetchRaw(
          deps.fetch,
          deps.raw,
          `/tcgplayer/${category}/${groupId}/${file}`,
          `${opts.raw}/${category}/${groupId}.${file}.json.gz`,
          opts.delayMs,
          // A group without products has no files.
          true,
        );
      for (const product of results<TcgProduct>(await fetchFile('products'), `products ${groupId}`))
        own.push({ groupId, product });
      prices.push(...results<TcgPrice>(await fetchFile('prices'), `prices ${groupId}`));
    }
    // The products the set's prints are mapped to now, so a reprint family keeps its group.
    const current = byId
      ? new Set<number>()
      : await deps.withDb(async (db) => {
          const ids = own.map((o) => String(o.product.productId));
          const held = await resolveMappings(db, SOURCE, ids);
          return new Set([...held.keys()].map((k) => Number(k.split('|')[0])));
        });
    const { products, reprints } = byId
      ? { products: own.map((o) => o.product), reprints: [] }
      : splitReprints(own, prices, current);
    const productIds = [...new Set(prices.map((p) => String(p.productId)))];
    const codes = [
      ...new Set(products.map((p) => codeOf(extended(p, 'Number') ?? '')).filter(Boolean)),
    ];

    const r = await deps.withDb(async (db) => {
      const others =
        game === 'yugioh'
          ? (await setIdsByCode(db, game, codes)).filter(
              (id) => id !== setId && !opts.grouped?.has(id),
            )
          : [];
      const candidates = await candidatePrints(db, [setId, ...others], byId ? productIds : []);
      // A product may price several prints (Yu-Gi-Oh! regional prints, VB-110).
      const matches = new Map<number, ProductMatch[]>();
      const regional = game === 'yugioh';
      for (const m of matchProducts(products, candidates, { byId, regional, setId })) {
        matches.set(m.productId, [...(matches.get(m.productId) ?? []), m]);
        if (m.artwork)
          log('info', {
            message: 'artwork variant picked',
            game,
            productId: m.productId,
            printId: m.printId,
          });
      }
      const finish = (p: TcgPrice) =>
        matches.get(p.productId)?.[0]?.finish ?? finishOf(p.subTypeName);
      const mappings: MappingRow[] = prices.flatMap((p) =>
        (matches.get(p.productId) ?? []).map((m) => ({
          printId: m.printId,
          source: SOURCE,
          externalId: String(p.productId),
          finish: finish(p),
          lang: 'en',
          method: m.method,
          confidence: m.confidence,
        })),
      );
      await upsertMappings(db, mappings);
      // Through the table, so a manual mapping counts as much as today's matches.
      const resolved = await resolveMappings(db, SOURCE, productIds);
      const rows: PriceRow[] = [];
      const priced = new Set<number>();
      let noMarket = 0;
      for (const p of prices) {
        const printIds = resolved.get(`${p.productId}|${finish(p)}`) ?? [];
        if (!printIds.length) continue;
        priced.add(p.productId);
        const market = cents(p.marketPrice);
        if (market === null) {
          noMarket++;
          continue;
        }
        for (const printId of printIds)
          rows.push({
            printId,
            finish: finish(p),
            source: SOURCE,
            lang: 'en',
            currency: 'USD',
            market,
            low: cents(p.lowPrice),
            mid: cents(p.midPrice),
            high: cents(p.highPrice),
          });
      }
      const written = await writePrices(db, rows, opts.observedAt);
      return { priced, written, noMarket };
    });

    // A reprint left out of the matching counts as a card all the same.
    const cardIds = [...products, ...reprints].filter(isCard).map((p) => p.productId);
    const mapped = cardIds.filter((id) => r.priced.has(id)).length;
    stats.cards += cardIds.length;
    stats.mapped += mapped;
    stats.unmapped += cardIds.length - mapped;
    stats.prices += r.written;
    stats.noMarket += r.noMarket;
  }
  return stats;
}

export async function runTcgcsvImport(
  deps: ImportDeps,
  step: StepRunner,
  opts: PriceImportOptions,
) {
  const delayMs = opts.delayMs ?? 100;
  const raw = `raw/${opts.env}/tcgcsv/${opts.date}`;
  const runId = await step('start run', () => deps.withDb((db) => startRun(db, 'tcgcsv')));
  try {
    // TCGCSV builds once a day: a run that finds no newer build pulls nothing else.
    const { observedAt, fresh } = await step('last updated', async () => {
      const at = await lastUpdated(deps.fetch, delayMs);
      return {
        observedAt: at,
        fresh: opts.force === true || at !== (await deps.withDb(lastImportedUpdate)),
      };
    });
    if (!fresh) {
      const stats = { lastUpdated: observedAt, skipped: 'TCGCSV has not been updated since' };
      // Nothing changed: no catalog_version bump, so the cached reads stay valid.
      await step('finish run', () =>
        deps.withDb((db) => finishRun(db, runId, stats, { bump: false })),
      );
      return { runId, stats };
    }

    const games: Partial<Record<PricedGame, GameStats>> = {};
    for (const game of opts.games ?? GAMES) {
      const category = CATEGORIES[game];
      const { total, matched } = await step(`groups ${game}`, async () => {
        const text = await fetchRaw(
          deps.fetch,
          deps.raw,
          `/tcgplayer/${category}/groups`,
          groupsKey(raw, game),
          delayMs,
        );
        const groups = results<TcgGroup>(text, `groups ${category}`);
        const sets = await deps.withDb((db) => gameSets(db, game));
        return {
          total: groups.length,
          matched: matchGroups(groups, sets, { regional: game === 'yugioh' }),
        };
      });
      const g: GameStats = {
        groups: total,
        matchedGroups: matched.length,
        cards: 0,
        mapped: 0,
        unmapped: 0,
        prices: 0,
        noMarket: 0,
      };
      const grouped = new Set(matched.map((m) => m.setId));
      for (const [i, groups] of groupSteps(matched).entries()) {
        const name = `prices ${game} ${String(i).padStart(3, '0')}`;
        const r = await step(name, () =>
          importGroups(deps, game, groups, { raw, delayMs, observedAt, grouped }),
        );
        for (const k of ['cards', 'mapped', 'unmapped', 'prices', 'noMarket'] as const)
          g[k] += r[k];
      }
      games[game] = g;
      // From the group list just kept, so the route and the log read the same thing. Logged inside
      // the step (a Workflow replays a finished step's result, not its body), and never fatal: the
      // prices are written by now.
      await step(`coverage ${game}`, async () => {
        try {
          const groups = (await readGroups(deps.raw, groupsKey(raw, game))) ?? [];
          const c = await deps.withDb((db) => priceCoverage(db, game, groups));
          const counts = coverageCounts(c);
          log('info', { message: 'price coverage', game, ...counts });
          for (const set of c.unpricedSets)
            log('warn', { message: 'set has a TCGplayer group and no price', game, ...set });
          return counts;
        } catch (err) {
          log('warn', { message: 'price coverage failed', game, error: String(err) });
          return null;
        }
      });
    }

    // `raw`: where the run kept its answers, the group lists of the coverage route among them.
    const stats = { lastUpdated: observedAt, raw, games };
    await step('finish run', () => deps.withDb((db) => finishRun(db, runId, stats)));
    await purgeEdgeCache(deps, step, ['prices']);
    return { runId, stats };
  } catch (err) {
    await step('fail run', () => deps.withDb((db) => failRun(db, runId, String(err))));
    throw err;
  }
}
