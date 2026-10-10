import type { CardStore } from '@voidbinder/core';
import type { Game } from '@voidbinder/shared';
import { COPYRIGHT } from '@voidbinder/shared/notices';
import type {
  Card,
  CardResponse,
  GameSummary,
  PrintDetail,
  PrintResponse,
  SetPageQuery,
  SetPageResponse,
  SetSummary,
} from '@voidbinder/shared/api';
import { and, asc, eq, inArray, isNotNull, sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { alias } from 'drizzle-orm/pg-core';
import {
  appMeta,
  cards,
  games,
  importRuns,
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

    const inSet = eq(prints.setId, setId);
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
          imageKey: prints.imageKey,
          externalIds: prints.externalIds,
          localizedImageKey: localized.imageKey,
          localizedIds: localized.externalIds,
        })
        .from(prints)
        .innerJoin(cards, eq(cards.id, prints.cardId))
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
        imageUrl: this.imageUrl(
          query.lang,
          { imageKey: r.localizedImageKey, externalIds: r.localizedIds },
          r,
        ),
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

  async getPrint(id: string): Promise<PrintResponse | null> {
    const [print] = await this.printDetails(eq(prints.id, id));
    const card = print && (await this.card(print.cardId));
    return print && card ? { print, card, copyright: COPYRIGHT[card.game] } : null;
  }
}
