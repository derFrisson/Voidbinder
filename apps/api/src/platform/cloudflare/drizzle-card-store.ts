import {
  conditionEstimate,
  DEFAULT_CONDITION_FACTORS,
  downsampleHistory,
  pickDisplayPrice,
  SOURCE_PREFERENCE,
  type CardStore,
} from '@voidbinder/core';
import type { Game } from '@voidbinder/shared';
import { COPYRIGHT } from '@voidbinder/shared/notices';
import type {
  Card,
  CardQuery,
  CardResponse,
  Condition,
  Currency,
  DisplayPrice,
  GameSummary,
  PriceHistoryResponse,
  PriceSource,
  PricesQuery,
  PrintDetail,
  PrintPricesResponse,
  PrintResponse,
  SearchQuery,
  SearchResponse,
  SetPageQuery,
  SetPageResponse,
  SetSummary,
} from '@voidbinder/shared/api';
import { and, asc, eq, gte, inArray, isNotNull, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { alias } from 'drizzle-orm/pg-core';
import {
  appMeta,
  cards,
  conditionMultipliers,
  games,
  importRuns,
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
      .select({ id: games.id, name: games.name, setCount: sql<number>`count(${sets.id})::int` })
      .from(games)
      .leftJoin(sets, eq(sets.gameId, games.id))
      .groupBy(games.id)
      .orderBy(games.sort);
    return rows.map((r) => ({ ...r, id: r.id as Game }));
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

    const [[count], rows, rarities, finishes, languages] = await Promise.all([
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
    ]);

    return {
      set: { ...set, game },
      prints: rows.map((r) => ({
        id: r.id,
        cardId: r.cardId,
        number: r.number,
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
        image: imagePick(prints, 'en'),
      })
      .from(prints)
      .innerJoin(sets, eq(sets.id, prints.setId))
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

    return rows.map(({ print: p, set, image }) => {
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
    // Each branch uses its own GIN index (cards_search_idx, print_localizations_search_idx); an
    // OR across both tables would scan cards. The search columns carry no weights, so a match in
    // the name adds 1 to ts_rank, otherwise a card whose text repeats the word outranks the card
    // named so. A print's best rank wins.
    const hits = sql`(
      select print_id, max(rank) as rank from (
        select ${prints.id} as print_id,
          ts_rank(${cards.search}, ${tsq}) + (to_tsvector('simple', ${cards.name}) @@ ${tsq})::int as rank
        from ${cards} join ${prints} on ${prints.cardId} = ${cards.id}
        where ${cards.search} @@ ${tsq}
        union all
        select ${printLocalizations.printId},
          ts_rank(${printLocalizations.search}, ${tsq}) +
            (to_tsvector('simple', ${printLocalizations.name}) @@ ${tsq})::int
        from ${printLocalizations}
        where ${printLocalizations.search} @@ ${tsq}
      ) h group by print_id
    ) hits`;
    const filters: SQL[] = [sql`true`];
    if (query.game) filters.push(sql`${sets.gameId} = ${query.game}`);
    if (query.set) filters.push(sql`${sets.code} = ${query.set}`);
    if (query.rarity) filters.push(sql`${prints.rarity} = ${query.rarity}`);
    if (query.finish) filters.push(sql`${query.finish} = any(${prints.finishes})`);
    const joins = sql`from ${hits}
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
    };
    const [count, rows] = await Promise.all([
      this.catalog.execute<{ total: number }>(
        sql`select count(*)::int as total ${joins} where ${where}`,
      ),
      // Page first, localize after: the CTE orders and cuts the hits, and only its rows are
      // joined to the localizations (a broad query matches thousands of prints).
      this.catalog.execute<Row>(sql`
        with page as (
          select ${prints.id}, ${prints.cardId} as card_id, ${prints.number}, ${prints.variant},
            ${cards.name} as card_name, ${cards.typeLine} as type_line, ${prints.rarity},
            ${prints.finishes},
            ${prints.imageKey} as image_key, ${prints.externalIds} as external_ids,
            ${sets.id} as set_id, ${sets.gameId} as game, ${sets.code} as set_code,
            ${sets.name} as set_name, ${sets.releasedOn} as released_on, hits.rank,
            ${NUMBER_VALUE} as number_value
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
          market.observed_at as price_observed_at, page.type_line, page.game, page.set_code, coalesce(set_l.name, page.set_name) as set_name
        from page
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
    return {
      prints: rows.rows.map((r) => ({
        id: r.id,
        cardId: r.card_id,
        number: r.number,
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

  async getPrint(id: string): Promise<PrintResponse | null> {
    const [print] = await this.printDetails(eq(prints.id, id));
    const card = print && (await this.card(print.cardId));
    return print && card ? { print, card, copyright: COPYRIGHT[card.game] } : null;
  }
}
