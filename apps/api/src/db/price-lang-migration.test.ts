import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, describe, expect, it } from 'vitest';
import { databaseUrl, freshDatabase, migrationConfig } from '../test-helpers';

// Migration 0013 (VB-103) on a database that already holds prices: every row becomes English (the
// Scryfall rows of a print in one other language: that language) and the keys take the language.
// The TimescaleDB run (compressed chunks) is in the PR's report.
describe.skipIf(!databaseUrl)('0013_price_lang (Postgres)', () => {
  const before = mkdtempSync(join(tmpdir(), 'vb-0012-'));
  afterAll(() => rmSync(before, { recursive: true, force: true }));

  it('keeps the rows as `en` and lets a German row sit next to an English one', async () => {
    const all = migrationConfig.migrationsFolder;
    const journal = JSON.parse(readFileSync(join(all, 'meta/_journal.json'), 'utf8')) as {
      entries: { tag: string }[];
    };
    const upTo = journal.entries.findIndex((e) => e.tag === '0013_price_lang');
    cpSync(all, before, { recursive: true });
    writeFileSync(
      join(before, 'meta/_journal.json'),
      JSON.stringify({ ...journal, entries: journal.entries.slice(0, upTo) }),
    );
    const { db, drop } = await freshDatabase(before);
    try {
      await db.execute(sql`
        with c as (insert into cards (game_id, name, oracle_key) values ('mtg', 'X', 'x') returning id),
          s as (insert into sets (game_id, code, name) values ('mtg', 'xxx', 'X') returning id),
          p as (insert into prints (card_id, set_id, number) select c.id, s.id, '1' from c, s returning id),
          m as (insert into price_mappings (print_id, source, external_id, finish, confidence, method)
            select id, 'tcgplayer', '1', 'normal', 100, 'scryfall_id' from p),
          pc as (insert into prices_current (print_id, finish, source, currency, cents_market, observed_at)
            select id, 'normal', 'cardmarket', 'EUR', 100, now() from p)
        insert into prices_daily (observed_at, print_id, finish, source, currency, cents_market)
          select '2026-10-01', id, 'normal', 'cardmarket', 'EUR', 100 from p`);
      // A Japanese-only print (neo 293 in the Scryfall fixtures): its Scryfall rows were `ja`
      // prices all along, its TCGplayer row stays English.
      const [ja] = (
        await db.execute<{ id: string }>(sql`
          with c as (insert into cards (game_id, name, oracle_key) values ('mtg', 'Plains', 'plains') returning id),
            s as (insert into sets (game_id, code, name) values ('mtg', 'neo', 'Kamigawa') returning id),
            p as (insert into prints (card_id, set_id, number) select c.id, s.id, '293' from c, s returning id),
            l as (insert into print_localizations (print_id, lang, name) select id, 'ja', '平地' from p),
            m as (insert into price_mappings (print_id, source, external_id, finish, confidence, method)
              select id, 'cardmarket', '605034', 'normal', 100, 'scryfall_id' from p),
            pc as (insert into prices_current (print_id, finish, source, currency, cents_market, observed_at)
              select id, 'normal', s.source, 'EUR', 100, now() from p,
                (values ('cardmarket'), ('tcgplayer_scryfall'), ('tcgplayer')) as s(source))
          select id from p`)
      ).rows;
      await migrate(db, migrationConfig);
      const langs = await db.execute<{ table: string; source: string; lang: string }>(sql`
        select 'mapping' as table, source, lang from price_mappings where print_id = ${ja?.id}
        union all select 'current', source, lang from prices_current where print_id = ${ja?.id}
        order by 1, 2`);
      expect(langs.rows).toEqual([
        { table: 'current', source: 'cardmarket', lang: 'ja' },
        { table: 'current', source: 'tcgplayer', lang: 'en' },
        { table: 'current', source: 'tcgplayer_scryfall', lang: 'ja' },
        { table: 'mapping', source: 'cardmarket', lang: 'ja' },
      ]);
      await db.execute(sql`delete from prices_current where print_id = ${ja?.id}`);
      await db.execute(sql`delete from price_mappings where print_id = ${ja?.id}`);

      for (const table of ['price_mappings', 'prices_current', 'prices_daily']) {
        const { rows } = await db.execute<{ lang: string }>(
          sql`select lang from ${sql.identifier(table)}`,
        );
        expect(rows).toEqual([{ lang: 'en' }]);
      }
      // The same day, print, finish and source in German: a row of its own.
      await db.execute(sql`
        insert into prices_daily (observed_at, print_id, finish, source, lang, currency, cents_market)
        select observed_at, print_id, finish, source, 'de', currency, 250 from prices_daily`);
      await db.execute(sql`
        insert into prices_current (print_id, finish, source, lang, currency, cents_market, observed_at)
        select print_id, finish, source, 'de', currency, 250, observed_at from prices_current`);
      await db.execute(sql`
        insert into price_mappings (print_id, source, external_id, finish, lang, confidence, method)
        select print_id, source, external_id, finish, 'de', confidence, method from price_mappings`);
      const { rows } = await db.execute<{ n: number }>(
        sql`select count(*)::int as n from prices_daily`,
      );
      expect(rows[0]?.n).toBe(2);
      // A second English row of the same day still conflicts.
      await expect(
        db.execute(sql`
          insert into prices_daily (observed_at, print_id, finish, source, currency, cents_market)
          select observed_at, print_id, finish, source, currency, 1 from prices_daily where lang = 'en'`),
      ).rejects.toMatchObject({ cause: { code: '23505' } });
    } finally {
      await drop();
    }
  });
});
