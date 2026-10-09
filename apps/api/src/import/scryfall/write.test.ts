import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appMeta, cards } from '../../db/schema';
import { databaseUrl, freshDatabase } from '../../test-helpers';
import { fixture } from './test-fixtures';
import type { ScryfallCard, ScryfallSet } from './types';
import { finishRun, importCardLines, startRun, upsertSets, type Db } from './write';

describe.skipIf(!databaseUrl)('Scryfall writes (Postgres)', () => {
  let db: Db;
  let drop: () => Promise<void>;
  beforeAll(async () => {
    ({ db, drop } = await freshDatabase());
    await upsertSets(db, (JSON.parse(fixture('sets.json')) as { data: ScryfallSet[] }).data);
  });
  afterAll(() => drop());

  const version = async () =>
    Number((await db.select().from(appMeta).where(eq(appMeta.key, 'catalog_version')))[0]?.value);

  it('finishRun bumps catalog_version once when the step is retried', async () => {
    const before = await version();
    const runId = await startRun(db, 'full');
    await finishRun(db, runId, { n: 1 });
    await finishRun(db, runId, { n: 2 });
    expect(await version()).toBe(before + 1);
  });

  it('keeps one card row whatever the order of its prints with and without faces', async () => {
    // Omen-style: one print carries the faces, another print of the same card does not.
    const line = fixture('default_cards.jsonl')
      .split('\n')
      .find((l) => l.includes('"name":"Blessed Defiance"'));
    const plain = JSON.parse(line ?? '') as ScryfallCard;
    const faced: ScryfallCard = {
      ...plain,
      name: 'Blessed Defiance // Omen of Defiance',
      card_faces: [
        { name: 'Blessed Defiance', type_line: 'Instant', oracle_text: plain.oracle_text ?? '' },
        { name: 'Omen of Defiance', type_line: 'Sorcery — Omen', oracle_text: 'Shuffle.' },
      ],
    };
    const other: ScryfallCard = { ...plain, id: 'b-side', collector_number: '500' };
    const lines = (...c: ScryfallCard[]) => c.map((x) => JSON.stringify(x));
    const row = async () =>
      (
        await db
          .select()
          .from(cards)
          .where(eq(cards.oracleKey, plain.oracle_id ?? ''))
      )[0];

    await importCardLines(db, lines(faced, other));
    const first = await row();
    expect(first?.name).toBe('Blessed Defiance // Omen of Defiance');

    const reversed = await importCardLines(db, lines(other, faced));
    expect(reversed.cards).toEqual({ inserted: 0, updated: 0, unchanged: 1 });
    // A later batch with only the face-less print leaves the faces alone.
    const alone = await importCardLines(db, lines(other));
    expect(alone.cards).toEqual({ inserted: 0, updated: 0, unchanged: 1 });
    expect(await row()).toEqual(first);
  });
});
