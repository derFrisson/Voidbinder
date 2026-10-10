import { printNumbers, type IndexedSuggestions, type SearchIndex } from '@voidbinder/core';
import type { CardFormat, Game } from '@voidbinder/shared';
import type { SearchSuggestion, SearchSuggestQuery } from '@voidbinder/shared/api';
import { fuzzyQuery, NUMBER_HITS, parseCodeQuery } from './drizzle-card-store';
import { IMAGE_LANGS, resolveImage, type ImagePick } from './image';

/**
 * How old the index may be before reads go to Postgres: the refresh runs after every daily
 * catalog import, so a day and a half means a whole day of refreshes failed.
 */
export const MAX_INDEX_AGE_MS = 36 * 3_600_000;

/**
 * Names the trigram index hands the similarity check (the best by bm25). Postgres checks every
 * name; on 266 sampled queries against the full local catalog 300 cut 3 names Postgres ranked 4th
 * to 8th, 500 matched every answer (typo queries 33 ms local median, 26 ms at 300).
 */
const FUZZY_CANDIDATES = 500;

/** pg_trgm's default `similarity_threshold`, the `%` operator of the Postgres search. */
const SIMILARITY_THRESHOLD = 0.3;

// JS twins of the SQL functions of drizzle/0010_search.sql, for the query side; the refresh copies
// the stored side from Postgres, so both sides are normalized the same way.

/** `catalog_code_key`: lower case, letters and digits, no leading zeros in a digit run. */
export const codeKey = (code: string) =>
  code
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .replace(/(^|[a-z])0+(?=[0-9])/g, '$1');

/** `catalog_number_key`: no separators, no 1–2 letter prefix, no leading zeros; null if empty. */
export const numberKey = (number: string) =>
  number
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .replace(/^[a-z]{1,2}(?=[0-9])/, '')
    .replace(/^0+/, '') || null;

/** The words of `s` in lower case, as pg_trgm splits them (letters and digits). */
const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/** The `grams` of a name_key: each word padded as pg_trgm pads it, two spaces before, one after. */
export const grams = (s: string) =>
  words(s)
    .map((w) => `  ${w} `)
    .join('');

/** pg_trgm's trigrams of `s`: those of each padded word. */
function trigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (const word of words(s)) {
    const chars = Array.from(`  ${word} `);
    for (let i = 0; i + 3 <= chars.length; i++) out.add(chars.slice(i, i + 3).join(''));
  }
  return out;
}

/** pg_trgm's `similarity(a, b)`: shared trigrams over all trigrams of both. */
export function similarity(a: string, b: string): number {
  const x = trigrams(a);
  const y = trigrams(b);
  let shared = 0;
  for (const t of x) if (y.has(t)) shared++;
  const all = x.size + y.size - shared;
  return all ? Math.fround(shared / all) : 0;
}

/**
 * The trigram index's candidates for names similar to `q`: names sharing a pg_trgm trigram of it,
 * leaving out a word's first letter alone (`  d`) and its last two letters (`er `): shared by a
 * large share of all names, they would make the index rank most of them (82,000 of 250,000 names
 * for `dunkler magier`), and a name sharing nothing else is never similar enough.
 */
function trigramQuery(q: string): string | null {
  const grams = [...trigrams(q)].filter((g) => !g.startsWith('  ') && !g.endsWith(' '));
  return grams.length ? grams.map((g) => `"${g}"`).join(' OR ') : null;
}

/** The upper bound of a prefix range on a name_key: every string that starts with `lo` is below. */
const prefixEnd = (lo: string) => `${lo}\u{10FFFF}`;

/** One statement's numbered parameters (`?1`, `?2`, …; D1 takes at most 100). */
class Params {
  readonly values: unknown[] = [];
  p(value: unknown): string {
    this.values.push(value);
    return `?${this.values.length}`;
  }
}

/** A filter on `n.lang` for `?names=`: all names, or one language's localized names. */
const langFilter = (params: Params, names: string) =>
  names === 'all' ? '' : `and n.lang = ${params.p(names)}`;

/**
 * The CTE `code(print_id, rank)` of the prints `q` names by code, as the Postgres `codeHits`
 * ranks them (see there); null when `q` cannot be a code.
 */
function codeCte(params: Params, q: string, game: Game | undefined): string | null {
  const { code, splits, number } = parseCodeQuery(q);
  const inGame = game ? `and s.game = ${params.p(game)}` : '';
  const branches: string[] = [];
  if (code) {
    const rows = [];
    for (let i = 1; i <= code.length; i++) {
      const rest = code.slice(i);
      rows.push([
        codeKey(code.slice(0, i)),
        rest,
        // A Yu-Gi-Oh! language code finds the English print (DE024 → EN024).
        rest.replace(/^(de|fr|it|pt|sp|es|jp|ja)(?=[0-9])/, 'en'),
        numberKey(rest),
        splits.includes(i) ? 10 + i / 100 : 0,
      ]);
    }
    branches.push(`select p.id as print_id, case
        when r.rest = '' then 0
        when p.number_alnum = r.rest or (s.game = 'yugioh' and p.number_alnum = r.rest_en)
          then 300 + r.typed
        when p.number_key = r.rest_key then 200 + r.typed
        else 150 + r.typed end as rank
      from (
        select value ->> 0 as part, value ->> 1 as rest, value ->> 2 as rest_en,
          value ->> 3 as rest_key, value ->> 4 as typed
        from json_each(${params.p(JSON.stringify(rows))})
      ) r
      join sets s on s.code_key = r.part ${inGame}
      join prints p on p.set_id = s.id
      where r.rest = '' or p.number_alnum like r.rest || '%' or p.number_key like r.rest_key || '%'`);
  }
  if (number) {
    const sized = number.total == null ? '' : `and s.card_count = ${params.p(number.total)}`;
    branches.push(`select * from (
      select p.id as print_id, ${number.total == null ? 200 : 300} as rank
      from prints p join sets s on s.id = p.set_id
      where p.number_key = ${params.p(numberKey(number.number))} ${sized} ${inGame}
      order by s.released_on desc nulls last, p.id
      limit ${NUMBER_HITS})`);
  }
  return branches.length ? `code(print_id, rank) as (${branches.join(' union all ')})` : null;
}

/** The newest print of card `cardId` (with a name in `names` unless `all`), as a subquery. */
function newestPrint(params: Params, cardId: string, names: string): string {
  const hasName =
    names === 'all'
      ? ''
      : `and exists (select 1 from names n2 where n2.print_id = p2.id and n2.lang = ${params.p(names)})`;
  return `(select p2.id from prints p2 join sets s2 on s2.id = p2.set_id
    where p2.card_id = ${cardId} ${hasName}
    order by s2.released_on desc nulls last, p2.number_value nulls last, p2.number, p2.variant, p2.id
    limit 1)`;
}

interface Meta {
  catalog_version?: string;
  synced_at?: string;
}

interface PrintRow {
  id: string;
  card_id: string;
  number: string;
  variant: string;
  rarity: string | null;
  name: string;
  image_src: string | null;
  localized_image_src: string | null;
  game: Game;
  set_code: string;
  set_name: string;
  card_count: number | null;
  card_format: CardFormat;
  localized: number;
}

interface SetRow {
  id: string;
  name: string;
  game: Game;
  code: string;
}

/** A keyed image of a print (`image.ts` candidates): its own key (English) or a localization's. */
interface ImageCandidate {
  target: string;
  print_id: string;
  same_set: number;
  released: string | null;
  lang: string;
  key: string;
  own: number;
}

const cmp = (x: number | string, y: number | string) => (x < y ? -1 : x > y ? 1 : 0);

/**
 * `imagePick` of image.ts over the candidates of `target`: its own chain, else the same chain on
 * another print of its card (same set first, then the newest, then by id).
 */
function pickImage(lang: string, target: string, rows: ImageCandidate[]): ImagePick | null {
  const rank = (c: ImageCandidate, ownIsRequested: boolean) =>
    c.lang === lang || (ownIsRequested && c.own) ? 0 : IMAGE_LANGS.indexOf(c.lang) + 1 || 8;
  const lowres = (c: ImageCandidate) => (c.key.includes('-lowres.') ? 1 : 0);
  const mine = rows.filter((c) => c.target === target);
  const [own] = mine
    .filter((c) => c.print_id === target)
    .sort(
      (a, b) =>
        cmp(rank(a, true), rank(b, true)) ||
        cmp(lowres(a), lowres(b)) ||
        cmp(a.own, b.own) ||
        cmp(a.lang, b.lang),
    );
  if (own) return { key: own.key, lang: own.lang, sibling: false };
  const [sibling] = mine
    .filter((c) => c.print_id !== target)
    .sort(
      (a, b) =>
        cmp(rank(a, false), rank(b, false)) ||
        cmp(lowres(a), lowres(b)) ||
        cmp(b.same_set, a.same_set) ||
        // Newest first, undated last.
        (a.released === b.released
          ? 0
          : !a.released
            ? 1
            : !b.released
              ? -1
              : cmp(b.released, a.released)) ||
        cmp(a.print_id, b.print_id) ||
        cmp(a.own, b.own) ||
        cmp(a.lang, b.lang),
    );
  return sibling ? { key: sibling.key, lang: sibling.lang, sibling: true } : null;
}

export interface D1SearchIndexOptions {
  /** Base URL of the R2 image domain, as for the card store. */
  imageBaseUrl?: string;
  /** The clock of the staleness check (tests). */
  now?: () => number;
}

/**
 * The typeahead from the search index in D1 (VB-98, ADR 0006), tier for tier as
 * `DrizzleCardStore.suggest` ranks it. Read through the Sessions API from the nearest replica
 * ('first-unconstrained'): the index only changes once a day, so a replica a few seconds behind
 * a refresh serves the previous index a few seconds longer, which the edge cache does anyway.
 */
export class D1SearchIndex implements SearchIndex {
  private readonly imageBaseUrl: string;
  private readonly now: () => number;

  constructor(
    private readonly db: D1Database,
    options: D1SearchIndexOptions = {},
  ) {
    this.imageBaseUrl = options.imageBaseUrl ?? '';
    this.now = options.now ?? Date.now;
  }

  /** catalog_version of a usable index, null when it was never synced or is older than MAX_INDEX_AGE_MS. */
  private version(rows: { key: string; value: string }[]): string | null {
    const meta: Meta = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    if (!meta.catalog_version || !meta.synced_at) return null;
    return this.now() - Date.parse(meta.synced_at) > MAX_INDEX_AGE_MS ? null : meta.catalog_version;
  }

  async suggest(query: SearchSuggestQuery, limit: number): Promise<IndexedSuggestions | null> {
    const session = this.db.withSession('first-unconstrained');
    const lo = query.q.toLowerCase();

    const code = new Params();
    const cte = codeCte(code, query.q, query.game);
    const codeSql =
      cte &&
      `with ${cte},
      ranked as (
        select c.print_id, max(c.rank) as rank, s.released_on, p.number_value, p.number
        from code c join prints p on p.id = c.print_id join sets s on s.id = p.set_id
        group by c.print_id
      ),
      ordered as (
        select print_id, rank, row_number() over (
          partition by rank > 0
          order by rank desc, released_on desc nulls last, number_value nulls last, number, print_id
        ) as ord
        from ranked
      )
      -- ponytail: a set named alone shows its first 3 prints, so name matches still fit.
      select print_id, rank, ord from ordered
      where ord <= case when rank > 0 then ${code.p(limit)} else 3 end`;

    const set = new Params();
    const { code: key } = parseCodeQuery(query.q);
    const range = (col: string) => `${col} >= ${set.p(lo)} and ${col} < ${set.p(prefixEnd(lo))}`;
    const setSql = `select id, row_number() over (order by released_on desc nulls last, code, id) as ord
      from sets s
      where (${key ? `s.code_key = ${set.p(codeKey(key))} or` : ''} ${range('s.name_key')}
        or exists (
          select 1 from set_names l
          where l.set_id = s.id and l.lang = ${set.p(query.lang)} and ${range('l.name_key')}
        )) ${query.game ? `and s.game = ${set.p(query.game)}` : ''}
      order by ord limit ${set.p(limit)}`;

    const prefix = new Params();
    const prefixSql = `with m as (
        select p.card_id, min(length(n.name)) as len, min(n.name) as name
        from names n join prints p on p.id = n.print_id join sets s on s.id = p.set_id
        where n.name_key >= ${prefix.p(lo)} and n.name_key < ${prefix.p(prefixEnd(lo))}
          ${langFilter(prefix, query.names)} ${query.game ? `and s.game = ${prefix.p(query.game)}` : ''}
        group by p.card_id order by len, name, p.card_id limit ${prefix.p(limit)}
      )
      select ${newestPrint(prefix, 'm.card_id', query.names)} as print_id from m order by len, name, card_id`;

    const [meta, codeRows, setRows, prefixRows] = await session.batch<Record<string, unknown>>([
      session.prepare(`select key, value from meta where key in ('catalog_version', 'synced_at')`),
      session
        .prepare(codeSql ?? 'select null as print_id, 0 as rank, 0 as ord where false')
        .bind(...code.values),
      session.prepare(setSql).bind(...set.values),
      session.prepare(prefixSql).bind(...prefix.values),
    ]);
    const catalogVersion = this.version((meta?.results ?? []) as { key: string; value: string }[]);
    if (!catalogVersion) return null;

    /** kind:id → best (tier, ord). */
    const cands = new Map<
      string,
      { kind: 'print' | 'set'; id: string; tier: number; ord: number }
    >();
    const add = (kind: 'print' | 'set', id: string | null, tier: number, ord: number) => {
      if (!id) return;
      const k = `${kind}:${id}`;
      const had = cands.get(k);
      if (!had || tier < had.tier || (tier === had.tier && ord < had.ord))
        cands.set(k, { kind, id, tier, ord });
    };
    for (const r of (codeRows?.results ?? []) as { print_id: string; rank: number; ord: number }[])
      add('print', r.print_id, r.rank >= 300 ? 0 : r.rank >= 200 ? 1 : r.rank > 0 ? 2 : 4, r.ord);
    for (const r of (setRows?.results ?? []) as { id: string; ord: number }[])
      add('set', r.id, 3, r.ord);
    const prefixed = (prefixRows?.results ?? []) as { print_id: string | null }[];
    prefixed.forEach((r, i) => add('print', r.print_id, 5, i + 1));

    if (fuzzyQuery(query.q) && prefixed.length < limit) {
      const fuzzy = await this.similarCards(session, query.q, query.game, query.names, limit);
      fuzzy.forEach((printId, i) => add('print', printId, 6, i + 1));
    }

    const top = [...cands.values()]
      .sort((a, b) => a.tier - b.tier || a.ord - b.ord)
      .slice(0, limit);
    const { prints, sets, images } = await this.hydrate(
      session,
      top.filter((c) => c.kind === 'print').map((c) => c.id),
      top.filter((c) => c.kind === 'set').map((c) => c.id),
      query.lang,
    );
    const suggestions = top.flatMap((c): SearchSuggestion[] => {
      if (c.kind === 'set') {
        const s = sets.get(c.id);
        return s
          ? [
              {
                kind: 'set',
                id: s.id,
                name: s.name,
                game: s.game,
                set: { code: s.code, name: s.name },
              },
            ]
          : [];
      }
      const r = prints.get(c.id);
      return r
        ? [
            {
              kind: 'print',
              id: r.id,
              name: r.name,
              game: r.game,
              set: { code: r.set_code, name: r.set_name },
              number: r.number,
              ...printNumbers(
                { game: r.game, setCode: r.set_code, number: r.number, cardCount: r.card_count },
                query.lang,
                Boolean(r.localized),
                key,
              ),
              cardFormat: r.card_format,
              variant: r.variant,
              rarity: r.rarity,
              ...resolveImage(this.imageBaseUrl, pickImage(query.lang, r.id, images), [
                { lang: query.lang, ids: { scryfall_images: { normal: r.localized_image_src } } },
                { lang: 'en', ids: { scryfall_images: { normal: r.image_src } } },
              ]),
              cardId: r.card_id,
            },
          ]
        : [];
    });
    return { result: { suggestions }, catalogVersion };
  }

  /**
   * The newest print of each card with a name similar to `q` (pg_trgm similarity 0.3 and up),
   * best first: the trigram index picks the candidates, `similarity` decides as Postgres does.
   */
  private async similarCards(
    session: D1DatabaseSession,
    q: string,
    game: Game | undefined,
    names: string,
    limit: number,
  ): Promise<string[]> {
    const match = trigramQuery(q);
    if (!match) return [];
    const params = new Params();
    const filters = () =>
      `${langFilter(params, names)} ${game ? `and s.game = ${params.p(game)}` : ''}`;
    const sql = `with k as (
        select k.name_key from name_trigrams join name_keys k on k.id = name_trigrams.rowid
        where name_trigrams match ${params.p(match)} ${
          names !== 'all' || game
            ? `and exists (select 1 from names n join prints p on p.id = n.print_id
                join sets s on s.id = p.set_id where n.name_key = k.name_key ${filters()})`
            : ''
        }
        order by name_trigrams.rank limit ${FUZZY_CANDIDATES}
      ),
      m as (
        select p.card_id, n.name from k join names n on n.name_key = k.name_key
        join prints p on p.id = n.print_id join sets s on s.id = p.set_id
        where true ${filters()}
      )
      select card_id, json_group_array(distinct name) as names,
        ${newestPrint(params, 'm.card_id', names)} as print_id
      from m group by card_id`;
    const rows = await session
      .prepare(sql)
      .bind(...params.values)
      .all<{ card_id: string; names: string; print_id: string | null }>();
    return rows.results
      .flatMap((r) => {
        const similar = (JSON.parse(r.names) as string[])
          .map((name) => ({ name, sml: similarity(name, q) }))
          .filter((n) => n.sml >= Math.fround(SIMILARITY_THRESHOLD));
        if (!similar.length || !r.print_id) return [];
        return [
          {
            cardId: r.card_id,
            printId: r.print_id,
            sml: Math.max(...similar.map((n) => n.sml)),
            name: similar.map((n) => n.name).sort()[0] ?? '',
          },
        ];
      })
      .sort((a, b) => b.sml - a.sml || cmp(a.name, b.name) || cmp(a.cardId, b.cardId))
      .slice(0, limit)
      .map((c) => c.printId);
  }

  /** Names, set and image of the prints and sets of a typeahead answer, in `lang`. */
  private async hydrate(
    session: D1DatabaseSession,
    printIds: string[],
    setIds: string[],
    lang: string,
  ): Promise<{
    prints: Map<string, PrintRow>;
    sets: Map<string, SetRow>;
    images: ImageCandidate[];
  }> {
    if (!printIds.length && !setIds.length)
      return { prints: new Map(), sets: new Map(), images: [] };
    // Siblings only for a print without a key of its own, as imagePick's COALESCE.
    const candidates = (own: string, lang: string, key: string, join: string, keyed: string) => `
      select t.id as target, sp.id as print_id, sp.set_id = t.set_id as same_set,
        coalesce(sp.released_on, s.released_on) as released, ${lang} as lang, ${key} as key,
        ${own} as own
      from prints t join prints sp on sp.card_id = t.card_id join sets s on s.id = sp.set_id ${join}
      where t.id in (select value from json_each(?1)) and ${keyed} and (sp.id = t.id or (
        t.image_key is null and not exists (
          select 1 from names tn where tn.print_id = t.id and tn.lang <> '' and tn.image_key is not null)))`;
    const [printRows, setRows, imageRows] = await session.batch<Record<string, unknown>>([
      session
        .prepare(
          `select p.id, p.card_id, p.number, p.variant, p.rarity, p.image_src,
            coalesce(nl.name, ne.name, p.card_name) as name, nl.image_src as localized_image_src,
            s.game, s.code as set_code, coalesce(sl.name, s.name) as set_name,
            s.card_count, s.card_format, nl.print_id is not null as localized
          from prints p join sets s on s.id = p.set_id
          left join set_names sl on sl.set_id = s.id and sl.lang = ?2
          left join names nl on nl.print_id = p.id and nl.lang = ?2
          left join names ne on ne.print_id = p.id and ne.lang = 'en'
          where p.id in (select value from json_each(?1))`,
        )
        .bind(JSON.stringify(printIds), lang),
      session
        .prepare(
          `select s.id, coalesce(sl.name, s.name) as name, s.game, s.code
          from sets s left join set_names sl on sl.set_id = s.id and sl.lang = ?2
          where s.id in (select value from json_each(?1))`,
        )
        .bind(JSON.stringify(setIds), lang),
      session
        .prepare(
          `${candidates('1', `'en'`, 'sp.image_key', '', 'sp.image_key is not null')}
          union all
          ${candidates('0', 'n.lang', 'n.image_key', 'join names n on n.print_id = sp.id', `n.image_key is not null and n.lang <> ''`)}`,
        )
        .bind(JSON.stringify(printIds)),
    ]);
    return {
      prints: new Map(((printRows?.results ?? []) as unknown as PrintRow[]).map((r) => [r.id, r])),
      sets: new Map(((setRows?.results ?? []) as unknown as SetRow[]).map((r) => [r.id, r])),
      images: (imageRows?.results ?? []) as unknown as ImageCandidate[],
    };
  }
}
