import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IMPORT_CADENCE } from './health';
import { CRON_SOURCES, cronInstanceId } from './schedule';

describe('CRON_SOURCES', () => {
  it('maps every cron of wrangler.jsonc to an import', () => {
    const config = readFileSync(new URL('../../wrangler.jsonc', import.meta.url).pathname, 'utf8');
    const crons = [...config.matchAll(/"crons"\s*:\s*\[([^\]]*)\]/g)].flatMap((m) =>
      [...(m[1] ?? '').matchAll(/"([^"]+)"/g)].map((c) => c[1]),
    );
    expect(crons.length).toBeGreaterThan(0);
    for (const cron of crons) expect(CRON_SOURCES, cron).toHaveProperty([cron as string]);
  });

  it('gives every scheduled source the import health cadence of its cron (VB-83)', () => {
    for (const [cron, source] of Object.entries(CRON_SOURCES))
      expect(IMPORT_CADENCE[source], cron).toBe(cron.endsWith(' * * *') ? 'daily' : 'weekly');
  });

  it('gives the late TCGCSV cron its own instance id', () => {
    const at = Date.parse('2026-10-10T20:30:00Z');
    expect(cronInstanceId('30 20 * * *', 'tcgcsv', at)).toBe('tcgcsv-2026-10-10');
    expect(cronInstanceId('30 22 * * *', 'tcgcsv', at + 7_200_000)).toBe('tcgcsv-2026-10-10-late');
    expect(cronInstanceId('0 3 * * *', 'scryfall', at)).toBe('scryfall-2026-10-10');
  });
});
