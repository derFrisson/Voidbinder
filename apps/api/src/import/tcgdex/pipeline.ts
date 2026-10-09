import type { BlobStore } from '@voidbinder/core';
import { batches, sourceHash } from '../util';
import { isDigitalSet, mapSet } from './map';
import { mapLimit, putJson, readText, type TcgdexClient } from './source';
import type { TcgdexCard, TcgdexSet } from './types';
import {
  addStats,
  failRun,
  finishRun,
  importCardChunk,
  markSet,
  setStates,
  startRun,
  upsertSets,
  type CardChunkStats,
  type Db,
  type MissingCards,
  type SetInput,
  type SetState,
  type WriteStats,
} from './write';

// The TCGdex import as a sequence of named, retryable steps, run through `step.do` by the Workflow
// (src/workflows/tcgdex-import.ts); tests and local runs pass a runner that just calls the
// function. Unlike Scryfall there is no dump to split: every card is one request per language, so
// the unit of work is a set's chunk of cards, and an incremental run (the cron's) refetches only
// the sets that are new, incomplete, recent, changed or due in the rolling refresh.

/** Cards per chunk and per Workflow step: 100 cards in two languages are about 200 requests. */
export const CHUNK_CARDS = 100;
/** Sets per `sets` step: 25 sets in two languages are about 50 requests. */
export const SET_BATCH = 25;
/** Sets released less than this many days ago are refetched on every run: TCGdex corrects them. */
export const RECENT_DAYS = 90;
/** Every set is refetched once in this many days, whatever else says (`rotates`). */
export const ROTATION_DAYS = 30;
const CARD_CONCURRENCY = 4;

export interface ImportDeps {
  client: TcgdexClient;
  blobs: BlobStore;
  /** Opens a connection for one step and closes it afterwards. */
  withDb<T>(fn: (db: Db) => Promise<T>): Promise<T>;
}

/** Runs one named step; its result must be JSON-serializable (it is persisted by Workflows). */
export type StepRunner = <T>(name: string, fn: () => Promise<T>) => Promise<T>;

export interface ImportOptions {
  /** `IMPORT_ENV` (`local`, `dev`, `prod`): every R2 key starts with `raw/<env>/`. */
  env: string;
  /** UTC day of the run: the raw copies go to `raw/<env>/tcgdex/<date>/`. */
  date: string;
  /** `en` is the master language (it creates the cards); the others add localizations. */
  languages: string[];
  /** `incremental` refetches only new, incomplete and recent sets; `full` every set. */
  mode: 'incremental' | 'full';
}

/** What a `sets` step learned about one set, and what the plan needs from it. */
export interface SetInfo {
  id: string;
  releaseDate: string | null;
  /** Cards TCGdex lists in English. */
  cards: number;
  /** Cards TCGdex lists per other language it has the set in. */
  other: Record<string, number>;
  /** Hash of the set details in every language (card briefs and image URLs included). */
  detailHash: string;
}

export interface SetsStepResult {
  sets: SetInfo[];
  stats: WriteStats;
  skipped: { digital: number; missing: number };
}

export interface PlannedSet {
  id: string;
  chunks: number;
  /** The other languages TCGdex has this set in. */
  langs: string[];
  detailHash: string;
}

const DAY = 86_400_000;

/**
 * The rolling refresh: a card's details (legality, errata) change without its set's details
 * changing, so every set is refetched on one day of the month, about 1/30 of them per day.
 */
export function rotates(id: string, date: string): boolean {
  let hash = 0x811c9dc5; // FNV-1a
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 0x01000193);
  return (hash >>> 0) % ROTATION_DAYS === new Date(date).getUTCDate() % ROTATION_DAYS;
}

/** Whether a set needs its cards fetched, given what the catalog already holds. */
export function needsImport(
  info: SetInfo,
  state: SetState | undefined,
  { mode, date }: Pick<ImportOptions, 'mode' | 'date'>,
): boolean {
  if (mode === 'full' || !state) return true;
  if (state.detailHash !== info.detailHash || rotates(info.id, date)) return true;
  // Cards TCGdex lists but answered 404 for last time count as present until the next refresh.
  const held = (n: number, lang: string) => n + (state.missingCards?.[lang]?.length ?? 0);
  if (held(state.prints, 'en') < info.cards) return true;
  if (
    Object.entries(info.other).some(([lang, n]) => held(state.localizations[lang] ?? 0, lang) < n)
  )
    return true;
  const released = info.releaseDate ? Date.parse(info.releaseDate) : NaN;
  return Date.parse(date) - released < RECENT_DAYS * DAY;
}

export function planSets(
  infos: SetInfo[],
  states: Map<string, SetState>,
  opts: Pick<ImportOptions, 'mode' | 'date'>,
): PlannedSet[] {
  return infos
    .filter((info) => info.cards > 0 && needsImport(info, states.get(info.id), opts))
    .map((info) => ({
      id: info.id,
      chunks: Math.ceil(info.cards / CHUNK_CARDS),
      langs: Object.keys(info.other),
      detailHash: info.detailHash,
    }));
}

const ZERO: WriteStats = { inserted: 0, updated: 0, unchanged: 0 };

export async function runTcgdexImport(deps: ImportDeps, step: StepRunner, opts: ImportOptions) {
  const runId = await step('start run', () =>
    deps.withDb((db) => startRun(db, opts.mode === 'full' ? 'full' : 'delta')),
  );
  const raw = `raw/${opts.env}/tcgdex/${opts.date}`;
  const setKey = (lang: string, id: string) => `${raw}/sets/${lang}/${id}.json`;
  const others = opts.languages.filter((l) => l !== 'en');
  try {
    const ids = await step('set list', async () => {
      const list = await deps.client.sets('en');
      await putJson(deps.blobs, `${raw}/sets.en.json`, list.text);
      return list.data.map((s) => s.id);
    });

    const infos: SetInfo[] = [];
    const setStats = { ...ZERO, skipped: { digital: 0, missing: 0 } };
    for (const [n, batch] of batches(ids, SET_BATCH).entries()) {
      const r = await step(`sets ${String(n).padStart(5, '0')}`, () =>
        importSetBatch(deps, batch, others, raw),
      );
      infos.push(...r.sets);
      Object.assign(setStats, addStats(setStats, r.stats));
      setStats.skipped.digital += r.skipped.digital;
      setStats.skipped.missing += r.skipped.missing;
    }

    const planned = await step('plan', async () =>
      planSets(infos, await deps.withDb((db) => setStates(db)), opts),
    );

    const zero = { inserted: 0, updated: 0, unchanged: 0 };
    const cards: CardChunkStats = { cards: zero, prints: zero, localizations: 0, missing: 0 };
    for (const set of planned) {
      const missing: MissingCards = {};
      for (let chunk = 0; chunk < set.chunks; chunk++) {
        const r = await step(`cards ${set.id} ${chunk}`, () =>
          importChunk(deps, { set, chunk, raw, setKey, missing }),
        );
        for (const [lang, ids] of Object.entries(r.missingIds)) (missing[lang] ??= []).push(...ids);
        cards.cards = addStats(cards.cards, r.cards);
        cards.prints = addStats(cards.prints, r.prints);
        cards.localizations += r.localizations;
        cards.missing += r.missing;
      }
    }

    const stats = {
      mode: opts.mode,
      languages: opts.languages,
      sets: setStats,
      planned: {
        sets: planned.length,
        chunks: planned.reduce((sum, s) => sum + s.chunks, 0),
        unchanged: infos.length - planned.length,
      },
      ...cards,
    };
    await step('finish run', () => deps.withDb((db) => finishRun(db, runId, stats)));
    return { runId, stats };
  } catch (err) {
    await step('fail run', () => deps.withDb((db) => failRun(db, runId, String(err))));
    throw err;
  }
}

/** Fetches the details of a batch of sets (raw copies to R2) and upserts the physical ones. */
async function importSetBatch(
  deps: ImportDeps,
  ids: string[],
  others: string[],
  raw: string,
): Promise<SetsStepResult> {
  const details = await mapLimit(ids, CARD_CONCURRENCY, async (id) => {
    const en = await deps.client.set('en', id);
    if (!en) return { id, en: null, other: {} };
    await putJson(deps.blobs, `${raw}/sets/en/${id}.json`, en.text);
    const other: Record<string, TcgdexSet> = {};
    if (!isDigitalSet(en.data))
      for (const lang of others) {
        const reply = await deps.client.set(lang, id);
        if (!reply) continue;
        await putJson(deps.blobs, `${raw}/sets/${lang}/${id}.json`, reply.text);
        other[lang] = reply.data;
      }
    return { id, en: en.data, other };
  });

  const skipped = { digital: 0, missing: 0 };
  const inputs: SetInput[] = [];
  const sets: SetInfo[] = [];
  for (const d of details) {
    if (!d.en) {
      skipped.missing++;
      continue;
    }
    if (isDigitalSet(d.en)) {
      skipped.digital++;
      continue;
    }
    inputs.push({
      row: mapSet(d.en),
      names: [
        { lang: 'en', name: d.en.name },
        ...Object.entries(d.other).map(([lang, s]) => ({ lang, name: s.name })),
      ],
    });
    sets.push({
      id: d.id,
      releaseDate: d.en.releaseDate ?? null,
      cards: d.en.cards.length,
      other: Object.fromEntries(Object.entries(d.other).map(([lang, s]) => [lang, s.cards.length])),
      detailHash: await sourceHash({ en: d.en, ...d.other }),
    });
  }
  const stats = await deps.withDb((db) => upsertSets(db, inputs));
  return { sets, stats, skipped };
}

/**
 * One chunk of a set: its cards in every language, a raw copy, then the upserts. The last chunk
 * also marks the set as imported (`markSet`) with the 404s of every chunk (`missing` holds the
 * earlier ones).
 */
async function importChunk(
  deps: ImportDeps,
  {
    set,
    chunk,
    raw,
    setKey,
    missing,
  }: {
    set: PlannedSet;
    chunk: number;
    raw: string;
    setKey: (lang: string, id: string) => string;
    missing: MissingCards;
  },
): Promise<CardChunkStats & { missingIds: MissingCards }> {
  const detail = async (lang: string) =>
    JSON.parse(await readText(deps.blobs, setKey(lang, set.id))) as TcgdexSet;
  const english = await detail('en');
  const slice = english.cards
    .slice(chunk * CHUNK_CARDS, (chunk + 1) * CHUNK_CARDS)
    .map((c) => c.id);

  const fetched: Record<string, (TcgdexCard | null)[]> = {};
  const missingIds: MissingCards = {};
  const rawLines: Record<string, string[]> = {};
  for (const lang of ['en', ...set.langs]) {
    const available = lang === 'en' ? null : new Set((await detail(lang)).cards.map((c) => c.id));
    const replies = await mapLimit(slice, CARD_CONCURRENCY, async (id) =>
      available && !available.has(id) ? null : deps.client.card(lang, id),
    );
    fetched[lang] = replies.map((r) => r?.data ?? null);
    const lost = slice.filter((id, i) => !replies[i] && (!available || available.has(id)));
    if (lost.length) missingIds[lang] = lost;
    // One compact line per card, as TCGdex answered it (prices and all).
    rawLines[lang] = replies.flatMap((r) => (r ? [JSON.stringify(r.data)] : []));
  }
  await Promise.all(
    Object.entries(rawLines).map(([lang, lines]) =>
      deps.blobs.put(
        `${raw}/cards/${set.id}/${String(chunk).padStart(5, '0')}.${lang}.jsonl`,
        `${lines.join('\n')}\n`,
        { contentType: 'application/x-ndjson' },
      ),
    ),
  );

  const { en, ...other } = fetched;
  const stats = await deps.withDb(async (db) => {
    const written = await importCardChunk(db, {
      setCode: set.id,
      releaseDate: english.releaseDate,
      en: en ?? [],
      other,
    });
    if (chunk === set.chunks - 1) {
      const all: MissingCards = { ...missing };
      for (const [lang, ids] of Object.entries(missingIds))
        all[lang] = [...(all[lang] ?? []), ...ids];
      await markSet(db, set.id, { detail_hash: set.detailHash, missing_cards: all });
    }
    return written;
  });
  return { ...stats, missingIds };
}
