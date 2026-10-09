import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CRON_SOURCES } from './schedule';

describe('CRON_SOURCES', () => {
  it('maps every cron of wrangler.jsonc to an import', () => {
    const config = readFileSync(new URL('../../wrangler.jsonc', import.meta.url).pathname, 'utf8');
    const crons = [...config.matchAll(/"crons"\s*:\s*\[([^\]]*)\]/g)].flatMap((m) =>
      [...(m[1] ?? '').matchAll(/"([^"]+)"/g)].map((c) => c[1]),
    );
    expect(crons.length).toBeGreaterThan(0);
    for (const cron of crons) expect(CRON_SOURCES, cron).toHaveProperty([cron as string]);
  });
});
