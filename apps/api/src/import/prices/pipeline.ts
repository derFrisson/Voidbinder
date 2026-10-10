import { failRun, finishRun } from '../scryfall/write';
import type { ImportDeps, StepRunner } from '../scryfall/pipeline';
import { log } from '../../middleware/log';
import { purgeEdgeCache } from '../util';
import {
  coverageCounts,
  groupsKey,
  priceCoverage,
  readGroups,
  type PriceCoverage,
} from './coverage';
import { isCard, matchGroups, matchProducts } from './match';
import {
  CATEGORIES,
  cents,
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
   * Imports the build even when the last run did: re-runs the matching for groups and products a
   * new rule maps (`POST /admin/import/tcgcsv?force=1`).
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

/** Imports the products and prices of a range of matched groups; returns their counts. */
export async function importGroups(
  deps: ImportDeps,
  game: PricedGame,
  groups: { groupId: number; setId: string }[],
  opts: { raw: string; delayMs: number; observedAt: string },
) {
  const category = CATEGORIES[game];
  const stats = { cards: 0, mapped: 0, unmapped: 0, prices: 0, noMarket: 0 };
  for (const { groupId, setId } of groups) {
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
    const products = results<TcgProduct>(await fetchFile('products'), `products ${groupId}`);
    const prices = results<TcgPrice>(await fetchFile('prices'), `prices ${groupId}`);
    const productIds = [...new Set(prices.map((p) => String(p.productId)))];

    const r = await deps.withDb(async (db) => {
      const byId = game === 'mtg';
      const candidates = await candidatePrints(db, [setId], byId ? productIds : []);
      const matches = new Map(
        matchProducts(products, candidates, { byId }).map((m) => [m.productId, m]),
      );
      const finish = (p: TcgPrice) => matches.get(p.productId)?.finish ?? finishOf(p.subTypeName);
      const mappings: MappingRow[] = prices.flatMap((p) => {
        const m = matches.get(p.productId);
        return m
          ? [
              {
                printId: m.printId,
                source: SOURCE,
                externalId: String(p.productId),
                finish: finish(p),
                lang: 'en',
                method: m.method,
                confidence: m.confidence,
              },
            ]
          : [];
      });
      await upsertMappings(db, mappings);
      // Through the table, so a manual mapping counts as much as today's matches.
      const resolved = await resolveMappings(db, SOURCE, productIds);
      const rows: PriceRow[] = [];
      const priced = new Set<number>();
      let noMarket = 0;
      for (const p of prices) {
        const printId = resolved.get(`${p.productId}|${finish(p)}`);
        if (!printId) continue;
        priced.add(p.productId);
        const market = cents(p.marketPrice);
        if (market === null) {
          noMarket++;
          continue;
        }
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

    const cardIds = products.filter(isCard).map((p) => p.productId);
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
    const coverage: Partial<
      Record<
        PricedGame,
        { counts: ReturnType<typeof coverageCounts>; unpriced: PriceCoverage['unpricedSets'] }
      >
    > = {};
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
        return { total: groups.length, matched: matchGroups(groups, sets) };
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
      for (let i = 0; i < matched.length; i += GROUPS_PER_STEP) {
        const name = `prices ${game} ${String(i / GROUPS_PER_STEP).padStart(3, '0')}`;
        const r = await step(name, () =>
          importGroups(deps, game, matched.slice(i, i + GROUPS_PER_STEP), {
            raw,
            delayMs,
            observedAt,
          }),
        );
        for (const k of ['cards', 'mapped', 'unmapped', 'prices', 'noMarket'] as const)
          g[k] += r[k];
      }
      games[game] = g;
      // From the group list just kept, so the route and the log read the same thing.
      coverage[game] = await step(`coverage ${game}`, async () => {
        const groups = (await readGroups(deps.raw, groupsKey(raw, game))) ?? [];
        const c = await deps.withDb((db) => priceCoverage(db, game, groups));
        return { counts: coverageCounts(c), unpriced: c.unpricedSets };
      });
    }
    const covered = Object.entries(coverage);
    log('info', {
      message: 'price coverage',
      ...Object.fromEntries(covered.map(([game, c]) => [game, c.counts])),
    });
    for (const [game, c] of covered)
      for (const set of c.unpriced)
        log('warn', { message: 'set has a TCGplayer group and no price', game, ...set });

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
