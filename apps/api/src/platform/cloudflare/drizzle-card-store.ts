import {
  conditionEstimate,
  DEFAULT_CONDITION_FACTORS,
  downsampleHistory,
  pickDisplayPrice,
  printNumbers,
  SOURCE_PREFERENCE,
  type CardStore,
} from '@voidbinder/core';
import type { CardFormat, Game } from '@voidbinder/shared';
import { COPYRIGHT } from '@voidbinder/shared/notices';
import {
  BAN_STATUSES,
  banLimit,
  type BanlistCard,
  type BanlistImpactQuery,
  type BanlistImpactResponse,
  type BanlistQuery,
  type BanlistResponse,
  type Card,
  type CardQuery,
  type CardResponse,
  type Condition,
  type Currency,
  type DisplayPrice,
  type GameSummary,
  type PriceHistoryResponse,
  type PriceSource,
  type PricesQuery,
  type PrintDetail,
  type PrintPricesResponse,
  type PrintResponse,
  type SearchQuery,
  type SearchResponse,
  type SearchSuggestQuery,
  type SearchSuggestResponse,
  type SetPageQuery,
  type SetPageResponse,
  type SetSummary,
} from '@voidbinder/shared/api';
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  sql,
  type SQL,
  type SQLWrapper,
} from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { alias } from 'drizzle-orm/pg-core';
import {
  appMeta,
  cards,
  collectionEntries,
  conditionMultipliers,
  deckEntries,
  decks,
  games,
  importRuns,
  legalityChanges,
  priceSources,
  pricesCurrent,
  pricesDaily,
  printLocalizations,
  prints,
  setLocalizations,
  sets,
} from '../../db/schema';
import { imagePick, resolveImage, type ImagePick } from './image';

type Ids = Record<string, unknown>;

export interface DrizzleCardStoreOptions {
  /** Pool for the catalog reads, the cached Hyperdrive config in production (ADR 0004). */
  catalogDb?: NodePgDatabase;
  /** Base URL of the R2 image domain; `image_key` is appended. */
  imageBaseUrl?: string;
}

const localized = alias(printLocalizations, 'localized');
const english = alias(printLocalizations, 'english');
const RARITY_ORDER = sql`case ${prints.rarity} when 'common' then 0 when 'uncommon' then 1 when 'rare' then 2 when 'mythic' then 3 else 4 end`;
/** Numeric part of a collector number ('12a' → 12), so 2 sorts before 10. */
const NUMBER_VALUE = sql`nullif(regexp_replace(${prints.number}, '[^0-9].*$', ''), '')::int`;
const NUMBER_ORDER = sql`${NUMBER_VALUE} nulls last`;

/**
 * Which finish a print's `marketPrice` takes, as an ORDER BY term (smallest first): the `normal`
 * finish, or the print's first finish when it has no normal; then the print's other finishes in
 * order; then a finish the print does not list but has a price row for (Yu-Gi-Oh!: TCGplayer
 * prices per edition, `first_edition`, while the print says `normal`).
 */
const finishRank = (finish: SQLWrapper, finishes: SQLWrapper) =>
  // An empty finishes array (schema default, TCGdex cards without variants) counts as ['normal'], like core.
  sql`case when ${finish} = case when 'normal' = any(${finishes}) or cardinality(${finishes}) = 0 then 'normal' else (${finishes})[1] end then 0 else coalesce(array_position(${finishes}, ${finish}), 98) + 1 end`;
const DAY_MS = 86_400_000;

/** `currency`'s preferred source first (core's SOURCE_PREFERENCE), as an ORDER BY term. */
const sourceOrder = (currency: Currency) =>
  sql`case ${pricesCurrent.source} ${sql.join(
    SOURCE_PREFERENCE[currency].map((source, i) => sql`when ${source} then ${i}`),
    sql` `,
  )} else 99 end`;

/** The `marketPrice` of a lateral row; null without a price. */
function displayPrice(m: {
  cents: number | null;
  currency: string | null;
  source: string | null;
  finish: string | null;
  /** A Date from the query builder, the driver's text from raw SQL. */
  observedAt: Date | string | null;
}): DisplayPrice | null {
  return m.cents == null || !m.currency || !m.source || !m.finish || !m.observedAt
    ? null
    : {
        cents: m.cents,
        currency: m.currency as Currency,
        source: m.source as PriceSource,
        finish: m.finish,
        observedAt: new Date(m.observedAt).toISOString(),
      };
}

/**
 * The text-search query for `q`: websearch syntax, and the last word as a prefix (`adel` finds
 * Adeline) unless it is negated or inside an open quote.
 */
function searchTsQuery(q: string): SQL {
  const m = /^(.*?)([\p{L}\p{N}]+)$/su.exec(q);
  const head = m?.[1] ?? '';
  const last = m?.[2];
  if (!last || head.endsWith('-') || (head.match(/"/g)?.length ?? 0) % 2) {
    return sql`websearch_to_tsquery('simple', ${q})`;
  }
  const prefix = sql`to_tsquery('simple', ${`${last}:*`})`;
  return head.trim() ? sql`(websearch_to_tsquery('simple', ${head}) && ${prefix})` : prefix;
}

/** What the code lookup reads from a search query (VB-79). */
export interface CodeQuery {
  /**
   * Lower case without spaces, `-`, `/`, `_`, `.` and non-ASCII characters other than letters and
   * digits (`97★` → `97`, as the SQL side strips them); null unless 2 to 16 ASCII letters and
   * digits, so other ASCII punctuation (websearch syntax, `Black Lotus!`) and non-ASCII letters
   * (`Pokémon`, `ポケモンGX`) are no code.
   */
  code: string | null;
  /** Where `code` had a separator between letters or digits (`sv1 01` → [3]); empty without code. */
  splits: number[];
  /** A bare number (`121`) or a printed `number/set size` (`001/128`); null otherwise. */
  number: { number: string; total: number | null } | null;
}

/** Reads a set code with a number (`LDS3-EN121`, `sv1 001`), a set code or a number from `q`. */
export function parseCodeQuery(q: string): CodeQuery {
  const parts = q
    .toLowerCase()
    .split(/[\s\-/_.]+|[^\p{L}\p{N}\p{ASCII}]+/u)
    .filter(Boolean);
  const code = parts.join('');
  const valid = /^[a-z0-9]{2,16}$/.test(code);
  let at = 0;
  const n = /^(\d{1,4})(?:\s*\/\s*(\d{1,4}))?$/.exec(q.trim());
  return {
    code: valid ? code : null,
    splits: valid ? parts.slice(0, -1).map((p) => (at += p.length)) : [],
    number: n?.[1] ? { number: n[1], total: n[2] ? Number(n[2]) : null } : null,
  };
}

/** A collector number in lower case, letters and digits only (`EN-121` → `en121`). */
const alnum = (number: SQLWrapper) => sql`regexp_replace(lower(${number}), '[^a-z0-9]+', '', 'g')`;

/** Prints a pure-number query lists at most (`121` matches that number in every set). */
export const NUMBER_HITS = 50;

/**
 * `(print_id, rank)` of the prints `q` names by code (VB-79), null when `q` cannot be one. Every
 * prefix of the normalized query is tried as a set code (catalog_code_key, sets_code_key_idx),
 * the rest as a number in that set: 300 the number as stored (a Yu-Gi-Oh! language code such as
 * `DE024` also finds `EN024`: German copies are localizations of the English print), 200 the same
 * number without prefix and leading zeros (`lds3 121`, `sv1 1`), 150 a number starting with the
 * rest (`lds3en12` → EN120…EN129), 0 every print of a set named alone (`lds3`, below the name
 * matches of /search). A split where the user typed a separator ranks 10 higher, a longer set code
 * among those slightly higher still (`swsh1 25` is swsh1 #25, not swsh12 #5; `sv03.5 12` splits
 * after `sv035`). A pure number matches within every set or, as `001/128`, within the sets
 * of that size (300, else 200), newest first, at most NUMBER_HITS.
 */
function codeHits(q: string, game: Game | undefined): SQL | null {
  const { code, splits, number } = parseCodeQuery(q);
  const branches: SQL[] = [];
  const inGame = game ? sql`and ${sets.gameId} = ${game}` : sql``;
  if (code) {
    const stored = alnum(prints.number);
    branches.push(sql`select ${prints.id} as print_id, (case
        when r.rest = '' then 0
        when ${stored} = r.rest
          or (${sets.gameId} = 'yugioh'
            and ${stored} = regexp_replace(r.rest, '^(de|fr|it|pt|sp|es|jp|ja)(?=[0-9])', 'en'))
          then 300 + r.typed
        when catalog_number_key(${prints.number}) = catalog_number_key(r.rest) then 200 + r.typed
        else 150 + r.typed end)::real as rank
      from (
        select left(${code}, i) as part, substr(${code}, i + 1) as rest,
          case when i = any(${`{${splits.join(',')}}`}::int[]) then 10 + i / 100.0 else 0 end as typed
        from generate_series(1, length(${code})) i
      ) r
      join ${sets} on catalog_code_key(${sets.code}) = catalog_code_key(r.part) ${inGame}
      join ${prints} on ${prints.setId} = ${sets.id}
      where r.rest = '' or ${stored} like r.rest || '%'
        or catalog_number_key(${prints.number}) like catalog_number_key(r.rest) || '%'`);
  }
  if (number) {
    const sized = number.total == null ? sql`` : sql`and ${sets.cardCount} = ${number.total}`;
    branches.push(sql`(select ${prints.id} as print_id,
        ${number.total == null ? 200 : 300}::real as rank
      from ${prints} join ${sets} on ${sets.id} = ${prints.setId}
      where catalog_number_key(${prints.number}) = catalog_number_key(${number.number})
        ${sized} ${inGame}
      order by ${sets.releasedOn} desc nulls last, ${prints.id}
      limit ${NUMBER_HITS})`);
  }
  return branches.length ? sql.join(branches, sql` union all `) : null;
}

/**
 * Whether names similar to `q` are worth looking for: below 4 characters nearly every name shares
 * a trigram with it, and a typo in so few letters is no typo.
 */
export const fuzzyQuery = (q: string) => q.length >= 4;

/** `q` as an ILIKE prefix pattern, its wildcards escaped. */
const prefixPattern = (q: string) => `${q.replace(/[\\%_]/g, '\\$&')}%`;

/**
 * The name filter of `?names=` (VB-79): `all` matches the English card name and every
 * localization; a language its localizations alone (`localization` adds the language condition).
 */
function nameScope(names: SearchQuery['names']) {
  const all = names === 'all';
  return {
    /** `branch union all` when the card name counts, else nothing. */
    card: (branch: SQL) => (all ? sql`${branch} union all` : sql``),
    // ponytail: `lang || ''` keeps the language off the primary key (print_id, lang); Postgres 18
    // would skip-scan it and filter every name in that language instead of using the name's GIN
    // index, then filter its few matches by language.
    localization: all ? sql`` : sql`and ${printLocalizations.lang} || '' = ${names}`,
  };
}

/**
 * A change since `since` (a UTC date) between two different restrictions: a card that only
 * enters or leaves a format unrestricted (null ↔ Unlimited) is no ban list change.
 */
const changeFilter = (since: string) => [
  gte(legalityChanges.seenAt, new Date(`${since}T00:00:00Z`)),
  sql`coalesce(${legalityChanges.fromStatus}, 'Unlimited') <> coalesce(${legalityChanges.toStatus}, 'Unlimited')`,
];

/**
 * The catalog in PostgreSQL. Catalog reads go through `catalogDb` and must stay free of `now()`
 * and other non-immutable functions, otherwise Hyperdrive does not cache them.
 */
export class DrizzleCardStore implements CardStore {
  private readonly catalog: NodePgDatabase;
  private readonly imageBaseUrl: string;

  constructor(
    private readonly db: NodePgDatabase,
    options: DrizzleCardStoreOptions = {},
  ) {
    this.catalog = options.catalogDb ?? db;
    this.imageBaseUrl = options.imageBaseUrl ?? '';
  }

  async ping(): Promise<void> {
    await this.db.execute(sql`select 1`);
  }

  async catalogVersion(): Promise<string> {
    const [row] = await this.catalog
      .select({ value: appMeta.value })
      .from(appMeta)
      .where(eq(appMeta.key, 'catalog_version'));
    return row?.value ?? '0';
  }

  async listGames(): Promise<GameSummary[]> {
    const rows = await this.catalog
      .select({
        id: games.id,
        name: games.name,
        cardFormat: games.cardFormat,
        setCount: sql<number>`count(${sets.id})::int`,
      })
      .from(games)
      .leftJoin(sets, eq(sets.gameId, games.id))
      .groupBy(games.id)
      .orderBy(games.sort);
    return rows.map((r) => ({ ...r, id: r.id as Game, cardFormat: r.cardFormat as CardFormat }));
  }

  private setSummaries(lang: string) {
    return this.catalog
      .select({
        id: sets.id,
        summary: {
          code: sets.code,
          name: sets.name,
          localizedName: setLocalizations.name,
          releasedOn: sets.releasedOn,
          cardCount: sets.cardCount,
          kind: sets.kind,
        },
      })
      .from(sets)
      .leftJoin(
        setLocalizations,
        and(eq(setLocalizations.setId, sets.id), eq(setLocalizations.lang, lang)),
      )
      .$dynamic();
  }

  async listSets(game: Game, lang: string): Promise<SetSummary[]> {
    const rows = await this.setSummaries(lang)
      .where(eq(sets.gameId, game))
      .orderBy(sql`${sets.releasedOn} desc nulls last`, sets.code);
    return rows.map((r) => r.summary);
  }

  /**
   * One cheap lateral lookup per print on prices_current's primary key: the print's `marketPrice`
   * (`finishRank`, then `sourceOrder`), joined with `leftJoinLateral(market, sql`true`)`.
   */
  private marketLateral(currency: Currency) {
    return this.catalog
      .select({
        cents: pricesCurrent.centsMarket,
        currency: pricesCurrent.currency,
        source: pricesCurrent.source,
        finish: pricesCurrent.finish,
        observedAt: pricesCurrent.observedAt,
      })
      .from(pricesCurrent)
      .where(eq(pricesCurrent.printId, prints.id))
      .orderBy(
        finishRank(pricesCurrent.finish, prints.finishes),
        pricesCurrent.finish,
        sourceOrder(currency),
      )
      .limit(1)
      .as('market');
  }

  /** `marketPrice` per print id, for the prints of a card. */
  private async marketPrices(
    ids: string[],
    currency: Currency,
  ): Promise<Map<string, DisplayPrice>> {
    const market = this.marketLateral(currency);
    const rows = ids.length
      ? await this.catalog
          .select({
            id: prints.id,
            market: {
              cents: market.cents,
              currency: market.currency,
              source: market.source,
              finish: market.finish,
              observedAt: market.observedAt,
            },
          })
          .from(prints)
          .leftJoinLateral(market, sql`true`)
          .where(inArray(prints.id, ids))
      : [];
    return new Map(
      rows.flatMap((r) => {
        const price = r.market && displayPrice(r.market);
        return price ? [[r.id, price] as const] : [];
      }),
    );
  }

  async getSetPage(
    game: Game,
    code: string,
    query: SetPageQuery,
    pageSize: number,
  ): Promise<SetPageResponse | null> {
    const [found] = await this.setSummaries(query.lang).where(
      and(eq(sets.gameId, game), eq(sets.code, code)),
    );
    if (!found) return null;
    const { id: setId, summary: set } = found;

    const filters: SQL[] = [eq(prints.setId, setId)];
    if (query.rarity) filters.push(eq(prints.rarity, query.rarity));
    if (query.finish) filters.push(sql`${query.finish} = any(${prints.finishes})`);
    const where = and(...filters);

    const name = sql<string>`coalesce(${localized.name}, ${english.name}, ${cards.name})`;

    const inSet = eq(prints.setId, setId);
    const market = this.marketLateral(query.currency);

    // The variants of a number follow each other (sorted by number or name).
    const order = {
      number: [NUMBER_ORDER, asc(prints.number), asc(prints.variant)],
      name: [asc(name), NUMBER_ORDER, asc(prints.number), asc(prints.variant)],
      rarity: [RARITY_ORDER, NUMBER_ORDER, asc(prints.number), asc(prints.variant)],
      // The price the page prints (`market`, joined laterally): prints priced in the requested
      // currency first (a fallback source in the other currency would mix cents), unpriced last.
      price: [
        sql`(${market.currency} = ${query.currency}) desc nulls last`,
        sql`${market.cents} desc nulls last`,
        NUMBER_ORDER,
        asc(prints.number),
        asc(prints.variant),
      ],
    }[query.sort];

    const [[count], rows, rarities, finishes, languages, [format]] = await Promise.all([
      this.catalog
        .select({ total: sql<number>`count(*)::int` })
        .from(prints)
        .where(where),
      this.catalog
        .select({
          id: prints.id,
          cardId: prints.cardId,
          number: prints.number,
          variant: prints.variant,
          name,
          rarity: prints.rarity,
          finishes: prints.finishes,
          image: imagePick(prints, query.lang),
          externalIds: prints.externalIds,
          localizedIds: localized.externalIds,
          localizedLang: localized.lang,
          market: {
            cents: market.cents,
            currency: market.currency,
            source: market.source,
            finish: market.finish,
            observedAt: market.observedAt,
          },
        })
        .from(prints)
        .innerJoin(cards, eq(cards.id, prints.cardId))
        .leftJoinLateral(market, sql`true`)
        .leftJoin(localized, and(eq(localized.printId, prints.id), eq(localized.lang, query.lang)))
        .leftJoin(english, and(eq(english.printId, prints.id), eq(english.lang, 'en')))
        .where(where)
        .orderBy(...order)
        .limit(pageSize)
        .offset((query.page - 1) * pageSize),
      this.catalog
        .select({ rarity: prints.rarity, count: sql<number>`count(*)::int` })
        .from(prints)
        .where(and(inSet, isNotNull(prints.rarity)))
        .groupBy(prints.rarity)
        .orderBy(sql`${RARITY_ORDER}`, sql`count(*) desc`, asc(prints.rarity)),
      this.catalog.execute<{ finish: string; count: number }>(
        sql`select f as finish, count(*)::int as count from ${prints}, unnest(${prints.finishes}) as f where ${prints.setId} = ${setId} group by f order by (f = 'normal') desc, count desc, f`,
      ),
      this.catalog
        .selectDistinct({ lang: printLocalizations.lang })
        .from(printLocalizations)
        .innerJoin(prints, eq(prints.id, printLocalizations.printId))
        .where(inSet)
        .orderBy(printLocalizations.lang),
      this.catalog.select({ cardFormat: games.cardFormat }).from(games).where(eq(games.id, game)),
    ]);
    const cardFormat = (format?.cardFormat ?? 'standard') as CardFormat;

    return {
      set: { ...set, game },
      prints: rows.map((r) => ({
        id: r.id,
        cardId: r.cardId,
        number: r.number,
        ...printNumbers(
          { game, setCode: set.code, number: r.number, cardCount: set.cardCount },
          query.lang,
          r.localizedLang !== null,
        ),
        cardFormat,
        variant: r.variant,
        name: r.name,
        rarity: r.rarity,
        finishes: r.finishes,
        ...resolveImage(this.imageBaseUrl, r.image, [
          { lang: query.lang, ids: r.localizedIds },
          { lang: 'en', ids: r.externalIds },
        ]),
        marketPrice: r.market ? displayPrice(r.market) : null,
      })),
      page: query.page,
      pageSize,
      total: count?.total ?? 0,
      facets: {
        rarities: rarities.flatMap((r) => (r.rarity ? [{ rarity: r.rarity, count: r.count }] : [])),
        finishes: finishes.rows,
        languages: languages.map((l) => l.lang),
      },
    };
  }

  /** Prints with set and localizations, newest first. */
  private async printDetails(where: SQL): Promise<PrintDetail[]> {
    const rows = await this.catalog
      .select({
        print: prints,
        set: { game: sets.gameId, code: sets.code, name: sets.name },
        cardCount: sets.cardCount,
        cardFormat: games.cardFormat,
        image: imagePick(prints, 'en'),
      })
      .from(prints)
      .innerJoin(sets, eq(sets.id, prints.setId))
      .innerJoin(games, eq(games.id, sets.gameId))
      .where(where)
      .orderBy(
        sql`${prints.releasedOn} desc nulls last`,
        sets.code,
        NUMBER_ORDER,
        prints.number,
        prints.variant,
      );
    if (!rows.length) return [];
    const localizations = await this.catalog
      .select({
        printId: printLocalizations.printId,
        lang: printLocalizations.lang,
        name: printLocalizations.name,
        text: printLocalizations.text,
        externalIds: printLocalizations.externalIds,
        image: imagePick(prints, printLocalizations.lang),
      })
      .from(printLocalizations)
      .innerJoin(prints, eq(prints.id, printLocalizations.printId))
      .where(
        inArray(
          printLocalizations.printId,
          rows.map((r) => r.print.id),
        ),
      )
      .orderBy(printLocalizations.lang);

    return rows.map(({ print: p, set, cardCount, cardFormat, image }) => {
      const shown = (lang: string) =>
        printNumbers(
          { game: set.game as Game, setCode: set.code, number: p.number, cardCount },
          lang,
          true,
        );
      // The image URLs are served as imageUrl.
      const externalIds = { ...p.externalIds };
      delete externalIds.scryfall_images;
      delete externalIds.scryfall_back_images;
      // The other sources' image URLs (VB-57 serves the images from R2) and TCGdex's
      // low-confidence marketplace guess (VB-30 does the matching) stay internal too.
      delete externalIds.tcgdex_images;
      delete externalIds.tcgdex_marketplace;
      delete externalIds.image_url;
      delete externalIds.image_url_small;
      return {
        id: p.id,
        cardId: p.cardId,
        set: { ...set, game: set.game as Game },
        number: p.number,
        ...shown('en'),
        cardFormat: cardFormat as CardFormat,
        variant: p.variant,
        rarity: p.rarity,
        finishes: p.finishes,
        artist: p.artist,
        releasedOn: p.releasedOn,
        ...resolveImage(this.imageBaseUrl, image, [{ lang: 'en', ids: p.externalIds }]),
        externalIds,
        localizations: localizations
          .filter((l) => l.printId === p.id)
          .map((l) => ({
            lang: l.lang,
            name: l.name,
            text: l.text,
            ...shown(l.lang),
            ...resolveImage(this.imageBaseUrl, l.image, [
              { lang: l.lang, ids: l.externalIds },
              { lang: 'en', ids: p.externalIds },
            ]),
          })),
      };
    });
  }

  private async card(id: string): Promise<Card | null> {
    const [c] = await this.catalog
      .select({
        id: cards.id,
        game: cards.gameId,
        name: cards.name,
        typeLine: cards.typeLine,
        text: cards.text,
        attributes: cards.attributes,
        legalities: cards.legalities,
      })
      .from(cards)
      .where(eq(cards.id, id));
    return c ? { ...c, game: c.game as Game } : null;
  }

  async getCard(id: string, query: CardQuery): Promise<CardResponse | null> {
    const card = await this.card(id);
    if (!card) return null;
    const details = await this.printDetails(eq(prints.cardId, id));
    const market = await this.marketPrices(
      details.map((p) => p.id),
      query.currency,
    );
    return {
      card,
      prints: details.map((p) => ({ ...p, marketPrice: market.get(p.id) ?? null })),
      // The card page shows it with each print's `artist` (VB-57).
      copyright: COPYRIGHT[card.game],
    };
  }

  async search(query: SearchQuery, pageSize: number): Promise<SearchResponse> {
    const tsq = searchTsQuery(query.q);
    const code = codeHits(query.q, query.game);
    // websearch syntax (a phrase, a negated word) asks for exact words: no similar names then.
    const fuzzy = fuzzyQuery(query.q) && !/"|(^|\s)-\S/.test(query.q);
    // Each text branch uses its own GIN index (cards_search_idx, print_localizations_search_idx);
    // an OR across both tables would scan cards. The search columns carry no weights, so a match
    // in the name adds 1 to ts_rank, otherwise a card whose text repeats the word outranks the
    // card named so. Code matches (codeHits) rank above them; names similar to `q` (pg_trgm `%`,
    // similarity 0.3 and up, so `Satelite` finds Satellite Warrior) answer only when neither finds
    // anything. A print's best rank wins.
    const names = nameScope(query.names);
    const hits = sql`ts as (
        ${names.card(sql`select ${prints.id} as print_id,
          ts_rank(${cards.search}, ${tsq}) + (to_tsvector('simple', ${cards.name}) @@ ${tsq})::int as rank
        from ${cards} join ${prints} on ${prints.cardId} = ${cards.id}
        where ${cards.search} @@ ${tsq}`)}
        select ${printLocalizations.printId} as print_id,
          ts_rank(${printLocalizations.search}, ${tsq}) +
            (to_tsvector('simple', ${printLocalizations.name}) @@ ${tsq})::int as rank
        from ${printLocalizations}
        where ${printLocalizations.search} @@ ${tsq} ${names.localization}
      ),
      code as (${code ?? sql`select null::uuid as print_id, null::real as rank where false`}),
      fuzzy as (
        ${names.card(sql`select ${prints.id} as print_id, similarity(${cards.name}, ${query.q}) as rank
        from ${cards} join ${prints} on ${prints.cardId} = ${cards.id}
        where ${fuzzy} and ${cards.name} % ${query.q}
          and not exists (select 1 from ts) and not exists (select 1 from code)`)}
        select ${printLocalizations.printId} as print_id,
          similarity(${printLocalizations.name}, ${query.q}) as rank
        from ${printLocalizations}
        where ${fuzzy} and ${printLocalizations.name} % ${query.q} ${names.localization}
          and not exists (select 1 from ts) and not exists (select 1 from code)
      ),
      hits as (
        select print_id, max(rank) as rank from (
          select * from ts union all select * from code union all select * from fuzzy
        ) h group by print_id
      )`;
    const filters: SQL[] = [sql`true`];
    if (query.game) filters.push(sql`${sets.gameId} = ${query.game}`);
    if (query.set) filters.push(sql`${sets.code} = ${query.set}`);
    if (query.rarity) filters.push(sql`${prints.rarity} = ${query.rarity}`);
    if (query.finish) filters.push(sql`${query.finish} = any(${prints.finishes})`);
    const joins = sql`from hits
      join ${prints} on ${prints.id} = hits.print_id
      join ${cards} on ${cards.id} = ${prints.cardId}
      join ${sets} on ${sets.id} = ${prints.setId}`;
    const where = sql.join(filters, sql` and `);
    type Row = {
      id: string;
      card_id: string;
      number: string;
      variant: string;
      name: string;
      rarity: string | null;
      finishes: string[];
      image: ImagePick | null;
      external_ids: Ids;
      localized_ids: Ids | null;
      price_cents: number | null;
      price_currency: Currency | null;
      price_source: DisplayPrice['source'] | null;
      price_finish: string | null;
      price_observed_at: Date | string | null;
      type_line: string | null;
      game: Game;
      set_code: string;
      set_name: string;
      card_count: number | null;
      card_format: CardFormat;
      localized: boolean;
    };
    const [count, rows] = await Promise.all([
      this.catalog.execute<{ total: number }>(
        sql`with ${hits} select count(*)::int as total ${joins} where ${where}`,
      ),
      // Page first, localize after: the CTE orders and cuts the hits, and only its rows are
      // joined to the localizations (a broad query matches thousands of prints).
      this.catalog.execute<Row>(sql`
        with ${hits}, page as (
          select ${prints.id}, ${prints.cardId} as card_id, ${prints.number}, ${prints.variant},
            ${cards.name} as card_name, ${cards.typeLine} as type_line, ${prints.rarity},
            ${prints.finishes},
            ${prints.imageKey} as image_key, ${prints.externalIds} as external_ids,
            ${sets.id} as set_id, ${sets.gameId} as game, ${sets.code} as set_code,
            ${sets.name} as set_name, ${sets.releasedOn} as released_on, hits.rank,
            ${sets.cardCount} as card_count, ${NUMBER_VALUE} as number_value
          ${joins}
          where ${where}
          order by hits.rank desc, ${cards.name}, ${sets.releasedOn} desc nulls last, ${sets.code},
            ${NUMBER_ORDER}, ${prints.number}, ${prints.variant}
          limit ${pageSize} offset ${(query.page - 1) * pageSize}
        )
        select page.id, page.card_id, page.number, page.variant,
          coalesce(localized.name, english.name, page.card_name) as name, page.rarity,
          page.finishes, page.external_ids, localized.external_ids as localized_ids,
          ${imagePick(
            {
              id: sql`page.id`,
              cardId: sql`page.card_id`,
              setId: sql`page.set_id`,
              imageKey: sql`page.image_key`,
            },
            query.lang,
          )} as image,
          market.cents as price_cents, market.currency as price_currency,
          market.source as price_source, market.finish as price_finish,
          market.observed_at as price_observed_at, page.type_line, page.game, page.set_code, coalesce(set_l.name, page.set_name) as set_name,
          page.card_count, g.card_format, localized.print_id is not null as localized
        from page
        join ${games} g on g.id = page.game
        left join ${printLocalizations} localized
          on localized.print_id = page.id and localized.lang = ${query.lang}
        left join ${printLocalizations} english
          on english.print_id = page.id and english.lang = 'en'
        left join ${setLocalizations} set_l
          on set_l.set_id = page.set_id and set_l.lang = ${query.lang}
        left join lateral (
          select ${pricesCurrent.centsMarket} as cents, ${pricesCurrent.currency} as currency,
            ${pricesCurrent.source} as source, ${pricesCurrent.finish} as finish,
            ${pricesCurrent.observedAt} as observed_at
          from ${pricesCurrent}
          where ${pricesCurrent.printId} = page.id
          order by ${finishRank(pricesCurrent.finish, sql`page.finishes`)}, ${pricesCurrent.finish},
            ${sourceOrder(query.currency)}
          limit 1
        ) market on true
        order by page.rank desc, page.card_name, page.released_on desc nulls last, page.set_code,
          page.number_value nulls last, page.number, page.variant`),
    ]);
    const { code: typed } = parseCodeQuery(query.q);
    return {
      prints: rows.rows.map((r) => ({
        id: r.id,
        cardId: r.card_id,
        number: r.number,
        ...printNumbers(
          { game: r.game, setCode: r.set_code, number: r.number, cardCount: r.card_count },
          query.lang,
          r.localized,
          typed,
        ),
        cardFormat: r.card_format,
        variant: r.variant,
        name: r.name,
        rarity: r.rarity,
        finishes: r.finishes,
        ...resolveImage(this.imageBaseUrl, r.image, [
          { lang: query.lang, ids: r.localized_ids },
          { lang: 'en', ids: r.external_ids },
        ]),
        marketPrice: displayPrice({
          cents: r.price_cents,
          currency: r.price_currency,
          source: r.price_source,
          finish: r.price_finish,
          observedAt: r.price_observed_at,
        }),
        typeLine: r.type_line,
        game: r.game,
        setCode: r.set_code,
        setName: r.set_name,
      })),
      page: query.page,
      pageSize,
      total: count.rows[0]?.total ?? 0,
    };
  }

  /**
   * The typeahead (VB-79) in one query: candidates per tier, each cut to `limit`, then the best
   * tier per print or set. Tiers: 0 the exact code, 1 the number without prefix or leading zeros
   * (and a pure number), 2 a partial number, 3 sets by code or name prefix, 4 the first prints of
   * a set named by its code, 5 cards whose name starts with `q`, 6 cards with a name similar to
   * `q` (only while tier 5 leaves room). A name match shows the card's newest print.
   */
  async suggest(query: SearchSuggestQuery, limit: number): Promise<SearchSuggestResponse> {
    const code = codeHits(query.q, query.game);
    const { code: key } = parseCodeQuery(query.q);
    const pattern = prefixPattern(query.q);
    const cardGame = query.game ? sql`and ${cards.gameId} = ${query.game}` : sql``;
    const setGame = query.game ? sql`and ${sets.gameId} = ${query.game}` : sql``;
    const names = nameScope(query.names);
    /** Card ids with the name each matched by, in the languages of `?names=`. */
    const named = (match: (name: SQLWrapper) => SQL) => sql`
      ${names.card(sql`select ${cards.id} as card_id, ${cards.name} as name from ${cards}
      where ${match(cards.name)} ${cardGame}`)}
      select ${prints.cardId} as card_id, ${printLocalizations.name} as name
      from ${printLocalizations}
      join ${prints} on ${prints.id} = ${printLocalizations.printId}
      join ${cards} on ${cards.id} = ${prints.cardId}
      where ${match(printLocalizations.name)} ${names.localization} ${cardGame}`;
    /** A print has a name in the one language of `?names=`. */
    const hasName =
      query.names === 'all'
        ? sql``
        : sql`and exists (select 1 from ${printLocalizations} where ${printLocalizations.printId} = ${prints.id} ${names.localization})`;
    /** The newest print of each card in `cte` (card_id, ord), as candidates of `tier`. */
    const newest = (cte: string, tier: number) => sql`
      select 'print' as kind, np.id, ${sql.raw(String(tier))} as tier, ${sql.raw(cte)}.ord
      from ${sql.raw(cte)} cross join lateral (
        select ${prints.id} as id from ${prints} join ${sets} on ${sets.id} = ${prints.setId}
        where ${prints.cardId} = ${sql.raw(cte)}.card_id ${hasName}
        order by ${sets.releasedOn} desc nulls last, ${NUMBER_ORDER}, ${prints.number}, ${prints.variant},
          ${prints.id}
        limit 1
      ) np`;
    type Row = {
      kind: 'print' | 'set';
      id: string;
      card_id: string | null;
      number: string | null;
      variant: string | null;
      name: string;
      rarity: string | null;
      image: ImagePick | null;
      external_ids: Ids | null;
      localized_ids: Ids | null;
      game: Game;
      set_code: string;
      set_name: string;
      card_count: number | null;
      card_format: CardFormat;
      localized: boolean;
    };
    const rows = await this.catalog.execute<Row>(sql`
      with code as (${code ?? sql`select null::uuid as print_id, null::real as rank where false`}),
      code_ranked as (
        select code.print_id, max(code.rank) as rank, min(${sets.releasedOn}) as released_on,
          min(${NUMBER_VALUE}) as number_value, min(${prints.number}) as number
        from code join ${prints} on ${prints.id} = code.print_id
        join ${sets} on ${sets.id} = ${prints.setId}
        group by code.print_id
      ),
      code_cands as (
        select 'print' as kind, print_id as id,
          case when rank >= 300 then 0 when rank >= 200 then 1 when rank > 0 then 2 else 4 end as tier,
          row_number() over (
            partition by rank > 0
            order by rank desc, released_on desc nulls last, number_value nulls last, number,
              print_id
          ) as ord
        from code_ranked
      ),
      set_cands as (
        select 'set' as kind, ${sets.id} as id, 3 as tier,
          row_number() over (order by ${sets.releasedOn} desc nulls last, ${sets.code}, ${sets.id}) as ord
        from ${sets}
        where (${key ? sql`catalog_code_key(${sets.code}) = catalog_code_key(${key}) or` : sql``}
          ${sets.name} ilike ${pattern}
          or exists (
            select 1 from ${setLocalizations}
            where ${setLocalizations.setId} = ${sets.id} and ${setLocalizations.lang} = ${query.lang}
              and ${setLocalizations.name} ilike ${pattern}
          )) ${setGame}
        order by ord limit ${limit}
      ),
      prefix as (
        select card_id, row_number() over (order by min(length(name)), min(name), card_id) as ord
        from (${named((name) => sql`${name} ilike ${pattern}`)}) n
        group by card_id order by ord limit ${limit}
      ),
      fuzzy as (
        select card_id, row_number() over (order by max(similarity(name, ${query.q})) desc, min(name), card_id) as ord
        from (${named((name) => sql`${name} % ${query.q}`)}) n
        where ${fuzzyQuery(query.q)} and (select count(*) from prefix) < ${limit}
        group by card_id order by ord limit ${limit}
      ),
      cands as (
        -- ponytail: a set named alone shows its first 3 prints, so name matches still fit.
        select * from code_cands where tier < 4 and ord <= ${limit} or tier = 4 and ord <= 3
        union all select * from set_cands
        union all ${newest('prefix', 5)}
        union all ${newest('fuzzy', 6)}
      ),
      top as (
        select kind, id, tier, ord from (
          select distinct on (kind, id) kind, id, tier, ord from cands order by kind, id, tier, ord
        ) best
        order by tier, ord limit ${limit}
      )
      select top.kind, top.id, ${prints.cardId} as card_id, ${prints.number}, ${prints.variant},
        case when top.kind = 'set' then coalesce(set_l.name, ${sets.name})
          else coalesce(localized.name, english.name, ${cards.name}) end as name,
        ${prints.rarity}, ${imagePick(prints, query.lang)} as image,
        ${prints.externalIds} as external_ids, localized.external_ids as localized_ids,
        ${sets.gameId} as game, ${sets.code} as set_code,
        coalesce(set_l.name, ${sets.name}) as set_name, ${sets.cardCount} as card_count,
        ${games.cardFormat} as card_format, localized.print_id is not null as localized
      from top
      left join ${prints} on top.kind = 'print' and ${prints.id} = top.id
      left join ${cards} on ${cards.id} = ${prints.cardId}
      join ${sets} on ${sets.id} = coalesce(${prints.setId}, top.id)
      join ${games} on ${games.id} = ${sets.gameId}
      left join ${printLocalizations} localized
        on localized.print_id = ${prints.id} and localized.lang = ${query.lang}
      left join ${printLocalizations} english
        on english.print_id = ${prints.id} and english.lang = 'en'
      left join ${setLocalizations} set_l
        on set_l.set_id = ${sets.id} and set_l.lang = ${query.lang}
      order by top.tier, top.ord`);
    return {
      suggestions: rows.rows.map((r) => {
        const set = { code: r.set_code, name: r.set_name };
        if (r.kind === 'set') return { kind: 'set', id: r.id, name: r.name, game: r.game, set };
        return {
          kind: 'print',
          id: r.id,
          name: r.name,
          game: r.game,
          set,
          number: r.number ?? '',
          ...printNumbers(
            { game: r.game, setCode: r.set_code, number: r.number ?? '', cardCount: r.card_count },
            query.lang,
            r.localized,
            key,
          ),
          cardFormat: r.card_format,
          variant: r.variant ?? '',
          rarity: r.rarity,
          ...resolveImage(this.imageBaseUrl, r.image, [
            { lang: query.lang, ids: r.localized_ids },
            { lang: 'en', ids: r.external_ids },
          ]),
          cardId: r.card_id ?? '',
        };
      }),
    };
  }

  async importRunning(source: string): Promise<boolean> {
    const [run] = await this.db
      .select({ id: importRuns.id })
      .from(importRuns)
      .where(
        and(
          eq(importRuns.source, source),
          eq(importRuns.status, 'running'),
          sql`${importRuns.startedAt} > now() - interval '6 hours'`,
        ),
      )
      .limit(1);
    return Boolean(run);
  }

  /** Game and finishes of a print, null when it does not exist. */
  private async printInfo(id: string) {
    const [row] = await this.catalog
      .select({ game: sets.gameId, finishes: prints.finishes })
      .from(prints)
      .innerJoin(sets, eq(sets.id, prints.setId))
      .where(eq(prints.id, id));
    return row ?? null;
  }

  async getPrintPrices(id: string, query: PricesQuery): Promise<PrintPricesResponse | null> {
    const print = await this.printInfo(id);
    if (!print) return null;
    const [rows, factors] = await Promise.all([
      this.catalog
        .select({ price: pricesCurrent, sourceLabel: priceSources.name })
        .from(pricesCurrent)
        .innerJoin(priceSources, eq(priceSources.id, pricesCurrent.source))
        .where(eq(pricesCurrent.printId, id))
        .orderBy(pricesCurrent.source, pricesCurrent.finish),
      this.catalog
        .select({ condition: conditionMultipliers.condition, factor: conditionMultipliers.factor })
        .from(conditionMultipliers)
        .where(eq(conditionMultipliers.gameId, print.game))
        .orderBy(sql`${conditionMultipliers.factor} desc`),
    ]);
    const prices = rows.map(({ price: p, sourceLabel }) => ({
      source: p.source as PriceSource,
      sourceLabel,
      finish: p.finish,
      currency: p.currency as Currency,
      market: p.centsMarket,
      low: p.centsLow,
      mid: p.centsMid,
      high: p.centsHigh,
      observedAt: p.observedAt.toISOString(),
    }));
    const display = pickDisplayPrice(prices, { ...query, finishes: print.finishes });
    return {
      printId: id,
      prices,
      display,
      conditions: display
        ? (factors.length
            ? factors.map((f) => ({
                condition: f.condition as Condition,
                factor: Number(f.factor),
              }))
            : DEFAULT_CONDITION_FACTORS
          ).map((f) => ({ ...f, cents: conditionEstimate(display.cents, f.factor) }))
        : [],
      conditionsAreEstimates: true,
    };
  }

  async getPriceHistory(
    id: string,
    days: number,
    today: string,
  ): Promise<PriceHistoryResponse | null> {
    if (!(await this.printInfo(id))) return null;
    const from = new Date(Date.parse(`${today}T00:00:00Z`) - days * DAY_MS);
    const rows = await this.catalog
      .select({
        observedAt: pricesDaily.observedAt,
        source: pricesDaily.source,
        finish: pricesDaily.finish,
        currency: pricesDaily.currency,
        cents: pricesDaily.centsMarket,
      })
      .from(pricesDaily)
      .where(and(eq(pricesDaily.printId, id), gte(pricesDaily.observedAt, from)))
      .orderBy(pricesDaily.source, pricesDaily.finish, pricesDaily.observedAt);
    const series = new Map<string, PriceHistoryResponse['series'][number]>();
    for (const r of rows) {
      const key = `${r.source}|${r.finish}|${r.currency}`;
      let s = series.get(key);
      if (!s) {
        s = {
          source: r.source as PriceSource,
          finish: r.finish,
          currency: r.currency as Currency,
          points: [],
        };
        series.set(key, s);
      }
      s.points.push({ date: r.observedAt.toISOString().slice(0, 10), cents: r.cents });
    }
    return {
      printId: id,
      days,
      series: [...series.values()].map((s) => ({
        ...s,
        points: downsampleHistory(s.points, today),
      })),
    };
  }

  /**
   * Ban list tiles: the card's name in `lang` and a representative print, the first with an
   * image of the earliest set (the original printing where it is mirrored), its image picked by
   * `imagePick` like every other print's.
   */
  private async banlistCards(ids: string[], lang: string): Promise<Map<string, BanlistCard>> {
    if (!ids.length) return new Map();
    const rep = this.catalog
      .select({
        id: prints.id,
        setId: prints.setId,
        number: prints.number,
        imageKey: prints.imageKey,
        externalIds: prints.externalIds,
        code: sets.code,
        cardCount: sets.cardCount,
      })
      .from(prints)
      .innerJoin(sets, eq(sets.id, prints.setId))
      .where(eq(prints.cardId, cards.id))
      .orderBy(
        sql`${prints.imageKey} is null`,
        sql`${sets.releasedOn} nulls last`,
        sets.code,
        prints.number,
      )
      .limit(1)
      .as('rep');
    const rows = await this.catalog
      .select({
        id: cards.id,
        name: sql<string>`coalesce(${localized.name}, ${english.name}, ${cards.name})`,
        printId: rep.id,
        number: rep.number,
        setCode: rep.code,
        image: imagePick(
          { id: rep.id, cardId: cards.id, setId: rep.setId, imageKey: rep.imageKey },
          lang,
        ),
        externalIds: rep.externalIds,
        localizedIds: localized.externalIds,
        localizedLang: localized.lang,
        game: cards.gameId,
        cardCount: rep.cardCount,
        cardFormat: games.cardFormat,
      })
      .from(cards)
      .innerJoin(games, eq(games.id, cards.gameId))
      .leftJoinLateral(rep, sql`true`)
      .leftJoin(localized, and(eq(localized.printId, rep.id), eq(localized.lang, lang)))
      .leftJoin(english, and(eq(english.printId, rep.id), eq(english.lang, 'en')))
      .where(inArray(cards.id, ids));
    return new Map(
      rows.map((r) => [
        r.id,
        {
          id: r.id,
          name: r.name,
          printId: r.printId,
          ...(r.printId
            ? resolveImage(this.imageBaseUrl, r.image, [
                { lang, ids: r.localizedIds },
                { lang: 'en', ids: r.externalIds },
              ])
            : { imageUrl: null }),
          setCode: r.setCode,
          number: r.number,
          displayNumber:
            r.setCode && r.number
              ? printNumbers(
                  {
                    game: r.game as Game,
                    setCode: r.setCode,
                    number: r.number,
                    cardCount: r.cardCount,
                  },
                  lang,
                  r.localizedLang !== null,
                ).displayNumber
              : null,
          cardFormat: r.cardFormat as CardFormat,
        },
      ]),
    );
  }

  /** The newest change per card in `format` since `since` that touched a restricted status. */
  private latestChanges(db: NodePgDatabase, format: string, since: string) {
    return db
      .selectDistinctOn([legalityChanges.cardId], {
        cardId: legalityChanges.cardId,
        from: legalityChanges.fromStatus,
        to: legalityChanges.toStatus,
        seenAt: legalityChanges.seenAt,
      })
      .from(legalityChanges)
      .where(and(eq(legalityChanges.format, format), ...changeFilter(since)))
      .orderBy(legalityChanges.cardId, desc(legalityChanges.seenAt))
      .as('latest');
  }

  async getBanlist(query: BanlistQuery, since: string): Promise<BanlistResponse> {
    const status = sql<string>`${cards.legalities} ->> ${query.format}`;
    const [listed, changes, [effective], [run]] = await Promise.all([
      this.catalog
        .select({ id: cards.id, status })
        .from(cards)
        .where(and(eq(cards.gameId, 'yugioh'), inArray(status, [...BAN_STATUSES]))),
      this.catalog
        .select({
          cardId: legalityChanges.cardId,
          from: legalityChanges.fromStatus,
          to: legalityChanges.toStatus,
          seenAt: legalityChanges.seenAt,
        })
        .from(legalityChanges)
        .innerJoin(cards, eq(cards.id, legalityChanges.cardId))
        .where(
          and(
            eq(cards.gameId, 'yugioh'),
            eq(legalityChanges.format, query.format),
            ...changeFilter(since),
          ),
        )
        .orderBy(desc(legalityChanges.seenAt), legalityChanges.cardId),
      this.catalog
        .select({ value: appMeta.value })
        .from(appMeta)
        .where(eq(appMeta.key, `banlist_${query.format}_effective`)),
      this.catalog
        .select({ at: sql<Date | string | null>`max(${importRuns.finishedAt})` })
        .from(importRuns)
        .where(and(eq(importRuns.source, 'ygoprodeck'), eq(importRuns.status, 'ok'))),
    ]);
    const tiles = await this.banlistCards(
      [...new Set([...listed.map((r) => r.id), ...changes.map((c) => c.cardId)])],
      query.lang,
    );
    const group = (s: string) =>
      listed
        .filter((r) => r.status === s)
        .flatMap((r) => tiles.get(r.id) ?? [])
        .sort((a, b) => a.name.localeCompare(b.name));
    return {
      format: query.format,
      effectiveDate: effective?.value ?? null,
      asOf: run?.at ? new Date(run.at).toISOString() : null,
      groups: {
        forbidden: group('Forbidden'),
        limited: group('Limited'),
        semiLimited: group('Semi-Limited'),
      },
      changes: changes.flatMap((c) => {
        const card = tiles.get(c.cardId);
        return card ? [{ card, from: c.from, to: c.to, seenAt: c.seenAt.toISOString() }] : [];
      }),
    };
  }

  async banlistImpact(
    userId: string,
    query: BanlistImpactQuery,
    since: string,
  ): Promise<BanlistImpactResponse> {
    const status = sql<string | null>`${cards.legalities} ->> ${query.format}`;
    const latest = this.latestChanges(this.db, query.format, since);
    const [owned, lines] = await Promise.all([
      this.db
        .select({
          cardId: cards.id,
          owned: sql<number>`sum(${collectionEntries.quantity})::int`,
          status,
          from: latest.from,
          to: latest.to,
          seenAt: latest.seenAt,
        })
        .from(collectionEntries)
        .innerJoin(prints, eq(prints.id, collectionEntries.printId))
        .innerJoin(cards, eq(cards.id, prints.cardId))
        .innerJoin(latest, eq(latest.cardId, cards.id))
        .where(
          and(
            eq(collectionEntries.userId, userId),
            isNull(collectionEntries.deletedAt),
            eq(cards.gameId, query.game),
          ),
        )
        .groupBy(cards.id, latest.from, latest.to, latest.seenAt),
      this.db
        .select({
          deckId: decks.id,
          deckName: decks.name,
          cardId: cards.id,
          copies: sql<number>`sum(${deckEntries.quantity})::int`,
          status,
          from: latest.from,
          to: latest.to,
          seenAt: latest.seenAt,
        })
        .from(deckEntries)
        .innerJoin(decks, eq(decks.id, deckEntries.deckId))
        .innerJoin(cards, eq(cards.id, deckEntries.cardId))
        .leftJoin(latest, eq(latest.cardId, cards.id))
        .where(and(eq(decks.userId, userId), isNull(decks.deletedAt), eq(decks.gameId, query.game)))
        .groupBy(decks.id, cards.id, latest.from, latest.to, latest.seenAt),
    ]);
    const hit = lines.filter((l) => {
      const limit = banLimit(l.status);
      return l.seenAt || (limit !== null && l.copies > limit);
    });
    const tiles = await this.banlistCards(
      [...new Set([...owned.map((o) => o.cardId), ...hit.map((l) => l.cardId)])],
      query.lang,
    );
    const change = (r: { from: string | null; to: string | null; seenAt: Date | null }) =>
      r.seenAt ? { from: r.from, to: r.to, seenAt: r.seenAt.toISOString() } : null;
    const byName = (a: { card: BanlistCard }, b: { card: BanlistCard }) =>
      a.card.name.localeCompare(b.card.name);
    return {
      format: query.format,
      collection: owned
        .flatMap((o) => {
          const card = tiles.get(o.cardId);
          const c = change(o);
          return card && c ? [{ card, owned: o.owned, status: o.status, change: c }] : [];
        })
        .sort(byName),
      decks: hit
        .flatMap((l) => {
          const card = tiles.get(l.cardId);
          return card
            ? [
                {
                  deck: { id: l.deckId, name: l.deckName },
                  card,
                  copies: l.copies,
                  limit: banLimit(l.status),
                  status: l.status,
                  change: change(l),
                },
              ]
            : [];
        })
        .sort((a, b) => a.deck.name.localeCompare(b.deck.name) || byName(a, b)),
    };
  }

  async getPrint(id: string): Promise<PrintResponse | null> {
    const [print] = await this.printDetails(eq(prints.id, id));
    const card = print && (await this.card(print.cardId));
    return print && card ? { print, card, copyright: COPYRIGHT[card.game] } : null;
  }
}
