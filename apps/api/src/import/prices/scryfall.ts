import { and, eq, inArray } from 'drizzle-orm';
import { prints, sets } from '../../db/schema';
import type { ImportDeps, StepRunner } from '../scryfall/pipeline';
import type { ScryfallCard } from '../scryfall/types';
import { failRun, finishRun, type Db } from '../scryfall/write';
import { chunkKey, readChunk } from '../scryfall/source';
import { purgeEdgeCache } from '../util';
import { startRun, upsertMappings, writePrices, type MappingRow, type PriceRow } from './write';

// Scryfall's prices (VB-30): `default_cards` carries Cardmarket EUR and TCGplayer USD per print.
// The catalog import already stored and split the day's dump in R2; this reads its chunks back,
// never fetching it again, and writes `cardmarket` (EUR) and `tcgplayer_scryfall` (USD) rows.

const PRICES = [
  ['eur', 'cardmarket', 'EUR', 'normal'],
  ['eur_foil', 'cardmarket', 'EUR', 'foil'],
  ['eur_etched', 'cardmarket', 'EUR', 'etched'],
  ['usd', 'tcgplayer_scryfall', 'USD', 'normal'],
  ['usd_foil', 'tcgplayer_scryfall', 'USD', 'foil'],
  ['usd_etched', 'tcgplayer_scryfall', 'USD', 'etched'],
] as const;

type Priced = Pick<ScryfallCard, 'set' | 'collector_number'> & {
  prices?: Record<string, string | null>;
  cardmarket_id?: number;
};

/** Print ids of Magic prints keyed `${set code}|${collector number}`. */
async function printIds(db: Db, cards: Priced[]) {
  const rows = await db
    .select({ id: prints.id, code: sets.code, number: prints.number })
    .from(prints)
    .innerJoin(sets, eq(sets.id, prints.setId))
    .where(
      and(
        eq(sets.gameId, 'mtg'),
        inArray(sets.code, [...new Set(cards.map((c) => c.set))]),
        inArray(prints.number, [...new Set(cards.map((c) => c.collector_number))]),
      ),
    );
  return new Map(rows.map((r) => [`${r.code}|${r.number}`, r.id]));
}

/** Writes the prices of one batch of `default_cards` lines. */
export async function writeScryfallPrices(db: Db, lines: string[], observedAt: string) {
  const cards = lines.map((l) => JSON.parse(l) as Priced);
  const ids = await printIds(db, cards);
  const rows: PriceRow[] = [];
  const mappings: MappingRow[] = [];
  let noPrint = 0;
  for (const card of cards) {
    const printId = ids.get(`${card.set}|${card.collector_number}`);
    if (!printId) {
      noPrint++;
      continue;
    }
    for (const [key, source, currency, finish] of PRICES) {
      const value = card.prices?.[key];
      if (!value) continue;
      rows.push({ printId, finish, source, currency, market: Math.round(Number(value) * 100) });
      if (source === 'cardmarket' && card.cardmarket_id)
        mappings.push({
          printId,
          source,
          externalId: String(card.cardmarket_id),
          finish,
          method: 'scryfall_id',
          confidence: 100,
        });
    }
  }
  await upsertMappings(db, mappings);
  return { prices: await writePrices(db, rows, observedAt), noPrint };
}

/**
 * Run by the Scryfall import after its catalog run and before it deletes the chunks: one step per
 * `default_cards` chunk (`prices 00000` …, the chunks of the `cards` steps) between a run row and
 * its finish with the catalog_version bump. Each step is idempotent, so a retry is safe and a
 * resumed instance continues at the failed chunk.
 */
export async function runScryfallPrices(
  deps: ImportDeps,
  step: StepRunner,
  opts: { work: string; chunks: number; observedAt: string },
) {
  const runId = await step('prices: start run', () =>
    deps.withDb((db) => startRun(db, 'scryfall')),
  );
  try {
    const stats = { lines: 0, prices: 0, noPrint: 0 };
    for (let i = 0; i < opts.chunks; i++) {
      const key = chunkKey(`${opts.work}/default_cards`, i);
      const r = await step(`prices ${String(i).padStart(5, '0')}`, async () => {
        const lines = await readChunk(deps.raw, key);
        const written = await deps.withDb((db) => writeScryfallPrices(db, lines, opts.observedAt));
        return { lines: lines.length, ...written };
      });
      stats.lines += r.lines;
      stats.prices += r.prices;
      stats.noPrint += r.noPrint;
    }
    await step('prices: finish run', () =>
      deps.withDb((db) => finishRun(db, runId, { observedAt: opts.observedAt, ...stats })),
    );
    await purgeEdgeCache(deps, step, ['prices'], 'prices: ');
    return stats;
  } catch (err) {
    await step('prices: fail run', () => deps.withDb((db) => failRun(db, runId, String(err))));
    throw err;
  }
}
