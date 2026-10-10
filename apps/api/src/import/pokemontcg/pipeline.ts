import type { BlobStore } from '@voidbinder/core';
import { eq, sql } from 'drizzle-orm';
import { appMeta, importRuns } from '../../db/schema';
import { failRun, finishRun, type Db } from '../scryfall/write';
import type { StepRunner } from '../tcgdex/pipeline';
import { putJson, type TcgdexClient } from '../tcgdex/source';
import { markChecked } from '../yugipedia/pipeline';
import { matchCards, matchSets, type OurPrint, type OurSet, type PtcgImageIds } from './match';
import { allPages, cardsPath, setsPath, type PtcgCard, type PtcgSet } from './source';

// The pokemontcg.io image import (VB-118): the backup picture for every Pokémon print TCGdex has
// none for (McDonald's collections, Shiny Vault, Dragon Majesty, Trainer and Galarian Galleries,
// trainer kits, …). It matches our sets to pokemontcg.io's (match.ts), fetches the cards of each
// matched set that has prints without `tcgdex_images` (raw copy to R2) and stores the card id and
// picture URLs in `prints.external_ids` (`pokemontcg`, `pokemontcg_images`); the image mirror
// copies `pokemontcg_images.large` when there is no TCGdex picture. A TCGdex picture is never
// overwritten: the write skips any print that has `tcgdex_images`. Runs as steps at the end of
// the TCGdex Workflow on Mondays (weekly); a set fetched is not fetched again for COOL_DOWN_DAYS.

export interface ImportDeps {
  client: TcgdexClient;
  blobs: BlobStore;
  withDb<T>(fn: (db: Db) => Promise<T>): Promise<T>;
}

export interface ImportOptions {
  /** `IMPORT_ENV`: the raw answers go to `raw/<env>/pokemontcg/<date>/`. */
  env: string;
  /** UTC day of the run. */
  date: string;
}

/** Days a fetched set waits before it is fetched again (a print still without a picture). */
export const COOL_DOWN_DAYS = 30;
/** `app_meta` key of the map set code → UTC day the set's cards were last fetched. */
export const CHECKED_KEY = 'pokemontcg_checked';

/** A print without any picture: no TCGdex one (VB-85's probe included) and none from here. */
const NO_PICTURE = sql`not (p.external_ids ? 'tcgdex_images') and not (p.external_ids ? 'pokemontcg_images')`;

interface SetRow extends OurSet {
  /** Prints without a picture. */
  missing: number;
}

async function ourSets(db: Db): Promise<SetRow[]> {
  const { rows } = await db.execute<{
    code: string;
    name: string;
    released_on: string | null;
    abbr: string | null;
    online: string | null;
    missing: number;
  }>(sql`
    select s.code, s.name, s.released_on::text as released_on,
      s.external_ids -> 'abbreviation' ->> 'official' as abbr,
      s.external_ids ->> 'tcgOnline' as online,
      (count(p.id) filter (where ${NO_PICTURE}))::int as missing
    from sets s left join prints p on p.set_id = s.id
    where s.game_id = 'pokemon'
    group by s.id
    order by s.code`);
  return rows.map((r) => ({
    code: r.code,
    name: r.name,
    releasedOn: r.released_on,
    codes: [r.abbr, r.online].filter((c): c is string => !!c),
    missing: r.missing,
  }));
}

async function checkedSince(db: Db, date: string): Promise<(code: string) => boolean> {
  const [meta] = await db
    .select({ value: appMeta.value })
    .from(appMeta)
    .where(eq(appMeta.key, CHECKED_KEY));
  const checked = JSON.parse(meta?.value ?? '{}') as Record<string, string>;
  const since = new Date(Date.parse(date) - COOL_DOWN_DAYS * 86_400_000).toISOString().slice(0, 10);
  return (code) => (checked[code] ?? '') > since;
}

export interface Plan {
  /** Our sets to fetch, with their pokemontcg.io set. */
  sets: { code: string; ptcg: string }[];
  /** Our sets with prints without a picture that no pokemontcg.io set matches. */
  unmatched: string[];
  /** Matched sets fetched within COOL_DOWN_DAYS. */
  coolingDown: number;
}

export function planSets(
  ours: SetRow[],
  theirs: PtcgSet[],
  recent: (code: string) => boolean,
): Plan {
  const matched = matchSets(ours, theirs);
  const plan: Plan = { sets: [], unmatched: [], coolingDown: 0 };
  for (const s of ours) {
    if (!s.missing) continue;
    const ptcg = matched.get(s.code);
    if (!ptcg) plan.unmatched.push(s.code);
    else if (recent(s.code)) plan.coolingDown++;
    else plan.sets.push({ code: s.code, ptcg });
  }
  return plan;
}

/** Our prints of `code` without a picture. */
/** Every print of the set; `hasPicture` marks those the matcher only counts. */
async function setPrints(db: Db, code: string): Promise<OurPrint[]> {
  const { rows } = await db.execute<{
    id: string;
    number: string;
    name: string;
    hasPicture: boolean;
  }>(sql`
    select p.id, p.number, c.name, not (${NO_PICTURE}) as "hasPicture" from prints p
    join sets s on s.id = p.set_id join cards c on c.id = p.card_id
    where s.game_id = 'pokemon' and s.code = ${code}
    order by p.number`);
  return rows;
}

/** Adds the matched ids to the prints; a print with a TCGdex picture is left alone. */
export async function writeImages(db: Db, matched: Map<string, PtcgImageIds>): Promise<number> {
  if (!matched.size) return 0;
  const values = JSON.stringify([...matched].map(([id, ids]) => ({ id, ids })));
  const { rowCount } = await db.execute(sql`
    update prints p set external_ids = p.external_ids || v.ids
    from jsonb_to_recordset(${values}::jsonb) as v(id uuid, ids jsonb)
    where p.id = v.id and not (p.external_ids ? 'tcgdex_images')
      and (p.external_ids -> 'pokemontcg_images', p.external_ids -> 'pokemontcg')
        is distinct from (v.ids -> 'pokemontcg_images', v.ids -> 'pokemontcg')`);
  return rowCount ?? 0;
}

export async function runPokemontcgImport(deps: ImportDeps, step: StepRunner, opts: ImportOptions) {
  const runId = await step('pokemontcg: start run', () =>
    deps.withDb(async (db) => {
      const [run] = await db
        .insert(importRuns)
        .values({ source: 'pokemontcg', kind: 'images' })
        .returning({ id: importRuns.id });
      if (!run) throw new Error('import_runs insert returned no row');
      return run.id;
    }),
  );
  const raw = `raw/${opts.env}/pokemontcg/${opts.date}`;
  try {
    const plan = await step('pokemontcg: plan', async () => {
      const list = await allPages<PtcgSet>(deps.client, setsPath);
      await putJson(deps.blobs, `${raw}/sets.json`, `[${list.bodies.join(',')}]`);
      return deps.withDb(async (db) =>
        planSets(await ourSets(db), list.data, await checkedSince(db, opts.date)),
      );
    });
    const stats = { sets: plan.sets.length, prints: 0, matched: 0, written: 0 };
    for (const { code, ptcg } of plan.sets) {
      const r = await step(`pokemontcg: cards ${code}`, async () => {
        const cards = await allPages<PtcgCard>(deps.client, cardsPath(ptcg));
        await putJson(deps.blobs, `${raw}/cards/${ptcg}.json`, `[${cards.bodies.join(',')}]`);
        return deps.withDb(async (db) => {
          const all = await setPrints(db, code);
          const prints = all.filter((p) => !p.hasPicture);
          const matched = matchCards(all, cards.data);
          const written = await writeImages(db, matched);
          await markChecked(db, [code], opts.date, CHECKED_KEY);
          return { prints: prints.length, matched: matched.size, written };
        });
      });
      stats.prints += r.prints;
      stats.matched += r.matched;
      stats.written += r.written;
    }
    const result = { ...stats, coolingDown: plan.coolingDown, unmatched: plan.unmatched };
    // Only the picture URLs changed: the catalog version moves only when a print did.
    await step('pokemontcg: finish run', () =>
      deps.withDb((db) => finishRun(db, runId, result, { bump: stats.written > 0 })),
    );
    return { runId, stats: result };
  } catch (err) {
    await step('pokemontcg: fail run', () => deps.withDb((db) => failRun(db, runId, String(err))));
    throw err;
  }
}
