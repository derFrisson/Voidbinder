/** An import that a cron starts daily. */
export type ScheduledSource = 'scryfall' | 'ygoprodeck' | 'tcgdex' | 'tcgcsv';

/**
 * Cron expression of wrangler.jsonc (every environment) → the import it starts. The only place
 * that maps them: `scheduled` (src/index.ts) reads it, schedule.test.ts checks every cron of
 * wrangler.jsonc against it.
 */
export const CRON_SOURCES: Record<string, ScheduledSource> = {
  // prod and local
  '0 3 * * *': 'scryfall',
  '30 3 * * *': 'ygoprodeck',
  '0 4 * * *': 'tcgdex',
  // prod and local only: TCGCSV asks for one pull per day, so dev prices run on demand
  // (POST /admin/import/tcgcsv). Its build lands around 20:00 UTC.
  '30 20 * * *': 'tcgcsv',
  // dev
  '30 4 * * *': 'scryfall',
  '0 5 * * *': 'ygoprodeck',
  '30 5 * * *': 'tcgdex',
};
