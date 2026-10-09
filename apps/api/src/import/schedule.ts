/** An import that a cron starts daily. */
export type ScheduledSource = 'scryfall' | 'ygoprodeck' | 'tcgdex';

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
  // dev
  '30 4 * * *': 'scryfall',
  '0 5 * * *': 'ygoprodeck',
  '30 5 * * *': 'tcgdex',
};
