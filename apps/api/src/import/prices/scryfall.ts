import { and, eq, inArray } from 'drizzle-orm';
import { prints, sets } from '../../db/schema';
import type { ImportDeps, StepRunner } from '../scryfall/pipeline';
import type { ScryfallCard } from '../scryfall/types';
import { failRun, finishRun, type Db } from '../scryfall/write';
import { jsonLines } from '../util';
import { startRun, upsertMappings, writePrices, type MappingRow, type PriceRow } from './write';

// Scryfall's prices (VB-30): `default_cards` carries Cardmarket EUR and TCGplayer USD per print.
// The catalog import already stored the day's dump in R2; this reads it back, never fetching it
// again, and writes `cardmarket` (EUR) and `tcgplayer_scryfall` (USD) rows.

const PRICES = [
  ['eur', 'cardmarket', 'EUR', 'normal'],
  ['eur_foil', 'cardmarket', 'EUR', 'foil'],
  ['eur_etched', 'cardmarket', 'EUR', 'etched'],
  ['usd', 'tcgplayer_scryfall', 'USD', 'normal'],
  ['usd_foil', 'tcgplayer_scryfall', 'USD', 'foil'],
  ['usd_etched', 'tcgplayer_scryfall', 'USD', 'etched'],
] as const;

/** Lines per lookup and write batch. */
const LINES = 2000;

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
 * Appended to the Scryfall import Workflow: three steps (run row, the prices of the whole dump,
 * finish with the catalog_version bump). The write step is idempotent, so a retry is safe.
 */
export async function runScryfallPrices(
  deps: ImportDeps,
  step: StepRunner,
  opts: { env: string; date: string; observedAt: string },
) {
  const runId = await step('prices: start run', () =>
    deps.withDb((db) => startRun(db, 'scryfall')),
  );
  try {
    const stats = await step('prices: write', async () => {
      const key = `raw/${opts.env}/scryfall/${opts.date}/default_cards.jsonl.gz`;
      const raw = await deps.raw.get(key);
      if (!raw) throw new Error(`${key} is missing`);
      const total = { lines: 0, prices: 0, noPrint: 0 };
      await deps.withDb(async (db) => {
        let batch: string[] = [];
        const flush = async () => {
          const r = await writeScryfallPrices(db, batch, opts.observedAt);
          total.prices += r.prices;
          total.noPrint += r.noPrint;
          batch = [];
        };
        const body = raw.body as ReadableStream<Uint8Array>;
        for await (const line of jsonLines(body, { gzip: true })) {
          total.lines++;
          batch.push(line);
          if (batch.length === LINES) await flush();
        }
        if (batch.length) await flush();
      });
      return total;
    });
    await step('prices: finish run', () =>
      deps.withDb((db) => finishRun(db, runId, { observedAt: opts.observedAt, ...stats })),
    );
    return stats;
  } catch (err) {
    await step('prices: fail run', () => deps.withDb((db) => failRun(db, runId, String(err))));
    throw err;
  }
}
