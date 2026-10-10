import {
  conditionEstimate,
  downsampleHistory,
  pickDisplayPrice,
  SOURCE_PREFERENCE,
  type CardStore,
} from '@voidbinder/core';
import type { Game } from '@voidbinder/shared';
import { COPYRIGHT } from '@voidbinder/shared/notices';
import type {
  Card,
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
  SetPageQuery,
  SetPageResponse,
  SetSummary,
} from '@voidbinder/shared/api';
import { and, asc, eq, gte, inArray, sql, type SQL } from 'drizzle-orm';
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

type Ids = Record<string, unknown>;
interface Image {
  imageKey: string | null;
  externalIds: Ids | null;
}

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
const NUMBER_ORDER = sql`nullif(regexp_replace(${prints.number}, '[^0-9].*$', ''), '')::int nulls last`;
/** The finish a set page prices: `normal`, or the print's first finish when it has no normal. */
const LIST_FINISH = sql`case when 'normal' = any(${prints.finishes}) then 'normal' else ${prints.finishes}[1] end`;
const DAY_MS = 86_400_000;

/** `currency`'s preferred source first (core's SOURCE_PREFERENCE), as an ORDER BY term. */
const sourceOrder = (currency: Currency) =>
  sql`case ${pricesCurrent.source} ${sql.join(
    SOURCE_PREFERENCE[currency].map((source, i) => sql`when ${source} then ${i}`),
    sql` `,
  )} else 99 end`;

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

  /**
   * Image of a print in `lang`: the localized R2 image, then the print's R2 image (English, so
   * only for `en` or when the language has no image of its own), then the localized source URL,
   * then the print's source URL. R2 images exist once VB-57 stored them.
   */
  private imageUrl(lang: string, localized: Image | null | undefined, print: Image): string | null {
    const r2 = (key: string | null) =>
      key && this.imageBaseUrl ? `${this.imageBaseUrl}/${key}` : null;
    const source = (ids: Ids | null | undefined) =>
      (ids?.scryfall_images as { normal?: string } | undefined)?.normal ?? null;
    const localizedSource = source(localized?.externalIds);
    return (
      r2(localized?.imageKey ?? null) ??
      (lang === 'en' || !localizedSource ? r2(print.imageKey) : null) ??
      localizedSource ??
      source(print.externalIds)
    );
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
    // The variants of a number follow each other (sorted by number or name).
    const order = {
      number: [NUMBER_ORDER, asc(prints.number), asc(prints.variant)],
      name: [asc(name), NUMBER_ORDER, asc(prints.number), asc(prints.variant)],
      rarity: [RARITY_ORDER, NUMBER_ORDER, asc(prints.number), asc(prints.variant)],
    }[query.sort];

    // One cheap lateral lookup per print on prices_current's primary key.
    const market = this.catalog
      .select({
        cents: pricesCurrent.centsMarket,
        currency: pricesCurrent.currency,
        source: pricesCurrent.source,
        finish: pricesCurrent.finish,
      })
      .from(pricesCurrent)
      .where(and(eq(pricesCurrent.printId, prints.id), eq(pricesCurrent.finish, LIST_FINISH)))
      .orderBy(sourceOrder(query.currency))
      .limit(1)
      .as('market');

    const [[count], rows] = await Promise.all([
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
          imageKey: prints.imageKey,
          externalIds: prints.externalIds,
          localizedImageKey: localized.imageKey,
          localizedIds: localized.externalIds,
          market: {
            cents: market.cents,
            currency: market.currency,
            source: market.source,
            finish: market.finish,
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
        imageUrl: this.imageUrl(
          query.lang,
          { imageKey: r.localizedImageKey, externalIds: r.localizedIds },
          r,
        ),
        marketPrice: r.market?.cents == null ? null : (r.market as DisplayPrice),
      })),
      page: query.page,
      pageSize,
      total: count?.total ?? 0,
    };
  }

  /** Prints with set and localizations, newest first. */
  private async printDetails(where: SQL): Promise<PrintDetail[]> {
    const rows = await this.catalog
      .select({ print: prints, set: { game: sets.gameId, code: sets.code, name: sets.name } })
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
      .select()
      .from(printLocalizations)
      .where(
        inArray(
          printLocalizations.printId,
          rows.map((r) => r.print.id),
        ),
      )
      .orderBy(printLocalizations.lang);

    return rows.map(({ print: p, set }) => {
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
        imageUrl: this.imageUrl('en', null, p),
        externalIds,
        localizations: localizations
          .filter((l) => l.printId === p.id)
          .map((l) => ({
            lang: l.lang,
            name: l.name,
            text: l.text,
            imageUrl: this.imageUrl(l.lang, l, p),
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

  async getCard(id: string): Promise<CardResponse | null> {
    const card = await this.card(id);
    return (
      card && {
        card,
        prints: await this.printDetails(eq(prints.cardId, id)),
        // The card page shows it with each print's `artist` (VB-57).
        copyright: COPYRIGHT[card.game],
      }
    );
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
        ? factors.map((f) => ({
            condition: f.condition as Condition,
            factor: Number(f.factor),
            cents: conditionEstimate(display.cents, Number(f.factor)),
          }))
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
