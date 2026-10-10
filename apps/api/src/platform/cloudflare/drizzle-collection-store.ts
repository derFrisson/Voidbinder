import {
  inBudget,
  priceEntry,
  valueBy,
  valueOf,
  type CollectionStore,
  type ExportRow,
} from '@voidbinder/core';
import type { Game } from '@voidbinder/shared';
import type {
  Binder,
  BinderOrderRequest,
  CollectionCondition,
  CollectionEntry,
  CollectionSummary,
  Condition,
  CreateBinderRequest,
  Currency,
  EntriesQuery,
  EntriesResponse,
  EntryPrice,
  EntryPrint,
  NewEntryData,
  NewWishData,
  OwnedQuery,
  OwnedResponse,
  PriceSource,
  UpdateBinderRequest,
  UpdateEntryRequest,
  UpdateWishRequest,
  WishlistEntry,
  WishlistQuery,
  WishlistResponse,
} from '@voidbinder/shared/api';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNull,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { alias } from 'drizzle-orm/pg-core';
import { HTTPException } from 'hono/http-exception';
import {
  binders,
  cards,
  collectionEntries,
  conditionMultipliers,
  pricesCurrent,
  printLocalizations,
  prints,
  sets,
  wishlistEntries,
} from '../../db/schema';

type Ids = Record<string, unknown>;
type Factors = Map<string, { condition: Condition; factor: number }[]>;
type PriceRow = {
  source: PriceSource;
  finish: string;
  currency: Currency;
  market: number;
  observedAt: string;
};

const notFound = (what: string) => new HTTPException(404, { message: `${what} not found` });

/** The Postgres error code under Drizzle's wrapper (`DrizzleQueryError.cause`). */
function pgCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } };
  return e.cause?.code ?? e.code;
}

const live = <T extends { deletedAt: unknown }>(t: T) => isNull(t.deletedAt as never);
const localized = alias(printLocalizations, 'localized');
const english = alias(printLocalizations, 'english');

/** `%q%` for ILIKE with the user's `%`, `_` and `\` taken literally. */
const contains = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * The collection in PostgreSQL (VB-31), always on the cache-disabled pool: a user reads their
 * own writes. Throws 404 (unknown, deleted or another user's row, unknown print or binder) and
 * 409 (a binder name taken) as HTTPExceptions.
 */
export class DrizzleCollectionStore implements CollectionStore {
  constructor(
    private readonly db: NodePgDatabase,
    private readonly imageBaseUrl = '',
  ) {}

  // ---- prints and prices ----

  /** The columns `toPrint` reads, joined in `withPrint`. */
  private readonly printColumns = {
    printId: prints.id,
    cardId: prints.cardId,
    game: sets.gameId,
    setCode: sets.code,
    setName: sets.name,
    number: prints.number,
    rarity: prints.rarity,
    finishes: prints.finishes,
    printImageKey: prints.imageKey,
    printIds: prints.externalIds,
    localizedName: localized.name,
    localizedImageKey: localized.imageKey,
    localizedIds: localized.externalIds,
    englishName: english.name,
    cardName: cards.name,
  };

  /**
   * Image like the catalog's (DrizzleCardStore.imageUrl): the R2 copy in the language, then the
   * print's, then the source's URL. ponytail: a copy of that private method, so this file does
   * not touch the card store while VB-35 and VB-56 change it; share it in a follow-up.
   */
  private imageUrl(r: {
    localizedImageKey: string | null;
    printImageKey: string | null;
    localizedIds: Ids | null;
    printIds: Ids | null;
  }): string | null {
    const r2 = (key: string | null) =>
      key && this.imageBaseUrl ? `${this.imageBaseUrl}/${key}` : null;
    const source = (ids: Ids | null) =>
      (ids?.scryfall_images as { normal?: string } | undefined)?.normal ?? null;
    return (
      r2(r.localizedImageKey) ?? r2(r.printImageKey) ?? source(r.localizedIds) ?? source(r.printIds)
    );
  }

  private toPrint(r: {
    printId: string;
    cardId: string;
    game: string;
    setCode: string;
    setName: string;
    number: string;
    rarity: string | null;
    finishes: string[];
    printImageKey: string | null;
    printIds: Ids;
    localizedName: string | null;
    localizedImageKey: string | null;
    localizedIds: Ids | null;
    englishName: string | null;
    cardName: string;
  }): EntryPrint {
    return {
      id: r.printId,
      cardId: r.cardId,
      game: r.game as Game,
      setCode: r.setCode,
      setName: r.setName,
      number: r.number,
      name: r.localizedName ?? r.englishName ?? r.cardName,
      rarity: r.rarity,
      finishes: r.finishes,
      imageUrl: this.imageUrl(r),
    };
  }

  /** Current prices per print id, and the condition factors per game. */
  private async prices(printIds: SQL | readonly string[]) {
    const where = Array.isArray(printIds)
      ? inArray(pricesCurrent.printId, printIds as string[])
      : sql`${pricesCurrent.printId} in (${printIds as SQL})`;
    const [rows, factorRows] = await Promise.all([
      Array.isArray(printIds) && printIds.length === 0
        ? []
        : this.db
            .select({
              printId: pricesCurrent.printId,
              source: pricesCurrent.source,
              finish: pricesCurrent.finish,
              currency: pricesCurrent.currency,
              market: pricesCurrent.centsMarket,
              observedAt: pricesCurrent.observedAt,
            })
            .from(pricesCurrent)
            .where(where),
      this.db.select().from(conditionMultipliers),
    ]);
    const byPrint = new Map<string, PriceRow[]>();
    for (const r of rows) {
      const list = byPrint.get(r.printId) ?? [];
      list.push({
        source: r.source as PriceSource,
        finish: r.finish,
        currency: r.currency as Currency,
        market: r.market,
        observedAt: r.observedAt.toISOString(),
      });
      byPrint.set(r.printId, list);
    }
    const factors: Factors = new Map();
    for (const f of factorRows) {
      const list = factors.get(f.gameId) ?? [];
      list.push({ condition: f.condition as Condition, factor: Number(f.factor) });
      factors.set(f.gameId, list);
    }
    return { byPrint, factors };
  }

  private priceOf(
    ctx: { byPrint: Map<string, PriceRow[]>; factors: Factors },
    r: { printId: string; game: string; finishes: string[] },
    finish: string | null,
    condition: CollectionCondition,
    currency: Currency,
  ): EntryPrice | null {
    return priceEntry(ctx.byPrint.get(r.printId) ?? [], {
      currency,
      finish,
      finishes: r.finishes,
      condition,
      factors: ctx.factors.get(r.game) ?? [],
    });
  }

  /** Every live binder id in `ids` must be the user's; 404 otherwise. */
  private async checkBinders(userId: string, ids: (string | null | undefined)[]) {
    const wanted = [...new Set(ids.filter((id): id is string => !!id))];
    if (!wanted.length) return;
    const [row] = await this.db
      .select({ n: count() })
      .from(binders)
      .where(and(eq(binders.userId, userId), live(binders), inArray(binders.id, wanted)));
    if (row?.n !== wanted.length) throw notFound('Binder');
  }

  /** A print that does not exist trips the foreign key; that is a 404 too. */
  private async insert<T>(write: () => Promise<T>, what: string): Promise<T> {
    try {
      return await write();
    } catch (err) {
      if (pgCode(err) === '23503') throw notFound(what);
      throw err;
    }
  }

  // ---- binders ----

  private toBinder(r: typeof binders.$inferSelect): Binder {
    return {
      id: r.id,
      name: r.name,
      game: r.gameId as Game | null,
      position: r.position,
      colour: r.colour,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  async listBinders(userId: string): Promise<Binder[]> {
    const rows = await this.db
      .select()
      .from(binders)
      .where(and(eq(binders.userId, userId), live(binders)))
      .orderBy(asc(binders.position), asc(binders.createdAt));
    return rows.map((r) => this.toBinder(r));
  }

  private async binderWrite<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (err) {
      if (pgCode(err) === '23505')
        throw new HTTPException(409, { message: 'A binder with that name exists' });
      throw err;
    }
  }

  async createBinder(userId: string, req: CreateBinderRequest): Promise<Binder> {
    const id = req.id ?? crypto.randomUUID();
    await this.binderWrite(() =>
      this.db
        .insert(binders)
        .values({
          id,
          userId,
          name: req.name,
          gameId: req.game ?? null,
          colour: req.colour ?? null,
          position: sql`(select coalesce(max(${binders.position}) + 1, 0) from ${binders} where ${binders.userId} = ${userId} and ${binders.deletedAt} is null)`,
        })
        .onConflictDoNothing({ target: binders.id }),
    );
    const [row] = await this.db
      .select()
      .from(binders)
      .where(and(eq(binders.id, id), eq(binders.userId, userId), live(binders)));
    // The id is another user's (or a deleted binder's): nothing was written.
    if (!row) throw new HTTPException(409, { message: 'Binder id taken' });
    return this.toBinder(row);
  }

  async updateBinder(userId: string, id: string, patch: UpdateBinderRequest): Promise<Binder> {
    const { game, ...rest } = patch;
    const [row] = await this.binderWrite(() =>
      this.db
        .update(binders)
        .set({ ...rest, ...(game !== undefined && { gameId: game }), updatedAt: sql`now()` })
        .where(and(eq(binders.id, id), eq(binders.userId, userId), live(binders)))
        .returning(),
    );
    if (!row) throw notFound('Binder');
    return this.toBinder(row);
  }

  async deleteBinder(userId: string, id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(binders)
        .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
        .where(and(eq(binders.id, id), eq(binders.userId, userId), live(binders)))
        .returning({ id: binders.id });
      if (!row) throw notFound('Binder');
      await tx
        .update(collectionEntries)
        .set({ binderId: null, updatedAt: sql`now()` })
        .where(and(eq(collectionEntries.binderId, id), eq(collectionEntries.userId, userId)));
    });
  }

  async orderBinders(userId: string, req: BinderOrderRequest): Promise<Binder[]> {
    const ids = [...new Set(req.ids)];
    await this.db.transaction(async (tx) => {
      const rows = await tx
        .select({ id: binders.id })
        .from(binders)
        .where(and(eq(binders.userId, userId), live(binders)))
        .orderBy(asc(binders.position), asc(binders.createdAt));
      const known = new Set(rows.map((r) => r.id));
      if (ids.some((id) => !known.has(id))) throw notFound('Binder');
      // A binder the list leaves out (made on another device meanwhile) goes to the end.
      const all = [...ids, ...rows.map((r) => r.id).filter((id) => !ids.includes(id))];
      if (!all.length) return;
      await tx
        .update(binders)
        .set({
          position: sql`array_position(${sql.param(all)}::uuid[], ${binders.id}) - 1`,
          updatedAt: sql`now()`,
        })
        .where(and(eq(binders.userId, userId), live(binders)));
    });
    return this.listBinders(userId);
  }

  // ---- entries ----

  private entryQuery(where: SQL | undefined) {
    return this.db
      .select({ entry: collectionEntries, ...this.printColumns })
      .from(collectionEntries)
      .innerJoin(prints, eq(prints.id, collectionEntries.printId))
      .innerJoin(cards, eq(cards.id, prints.cardId))
      .innerJoin(sets, eq(sets.id, prints.setId))
      .leftJoin(
        localized,
        and(eq(localized.printId, prints.id), eq(localized.lang, collectionEntries.language)),
      )
      .leftJoin(english, and(eq(english.printId, prints.id), eq(english.lang, 'en')))
      .where(where);
  }

  private async pricedEntries(
    rows: Awaited<ReturnType<DrizzleCollectionStore['entryQuery']>>,
    currency: Currency,
  ): Promise<CollectionEntry[]> {
    const ctx = await this.prices(rows.map((r) => r.printId));
    return rows.map((r) => {
      const e = r.entry;
      const condition = e.condition as CollectionCondition;
      return {
        id: e.id,
        printId: e.printId,
        binderId: e.binderId,
        quantity: e.quantity,
        language: e.language,
        condition,
        finish: e.finish,
        purchasePriceCents: e.purchasePriceCents,
        purchaseCurrency: e.purchaseCurrency as Currency | null,
        note: e.note,
        createdAt: e.createdAt.toISOString(),
        updatedAt: e.updatedAt.toISOString(),
        print: this.toPrint(r),
        price: this.priceOf(ctx, r, e.finish, condition, currency),
      };
    });
  }

  /** Name (any language) or collector number. */
  private search(q: string) {
    return or(
      ilike(cards.name, contains(q)),
      sql`exists (select 1 from ${printLocalizations} where ${printLocalizations.printId} = ${prints.id} and ${printLocalizations.name} ilike ${contains(q)})`,
      sql`lower(${prints.number}) = lower(${q})`,
    );
  }

  async listEntries(
    userId: string,
    query: EntriesQuery & { currency: Currency },
    pageSize: number,
  ): Promise<EntriesResponse> {
    const where = and(
      eq(collectionEntries.userId, userId),
      live(collectionEntries),
      query.binder === 'none'
        ? isNull(collectionEntries.binderId)
        : query.binder
          ? eq(collectionEntries.binderId, query.binder)
          : undefined,
      query.game ? eq(sets.gameId, query.game) : undefined,
      query.set ? sql`lower(${sets.code}) = lower(${query.set})` : undefined,
      query.condition ? eq(collectionEntries.condition, query.condition) : undefined,
      query.lang ? eq(collectionEntries.language, query.lang) : undefined,
      query.q ? this.search(query.q) : undefined,
    );
    const [rows, [total]] = await Promise.all([
      this.entryQuery(where)
        .orderBy(desc(collectionEntries.createdAt), desc(collectionEntries.id))
        .limit(pageSize)
        .offset((query.page - 1) * pageSize),
      this.db
        .select({ n: count() })
        .from(collectionEntries)
        .innerJoin(prints, eq(prints.id, collectionEntries.printId))
        .innerJoin(cards, eq(cards.id, prints.cardId))
        .innerJoin(sets, eq(sets.id, prints.setId))
        .where(where),
    ]);
    return {
      entries: await this.pricedEntries(rows, query.currency),
      page: query.page,
      pageSize,
      total: total?.n ?? 0,
    };
  }

  private async entriesById(userId: string, ids: string[], currency: Currency) {
    const rows = await this.entryQuery(
      and(
        eq(collectionEntries.userId, userId),
        live(collectionEntries),
        inArray(collectionEntries.id, ids),
      ),
    );
    const entries = await this.pricedEntries(rows, currency);
    const byId = new Map(entries.map((e) => [e.id, e]));
    return ids.flatMap((id) => byId.get(id) ?? []);
  }

  async createEntries(
    userId: string,
    entries: NewEntryData[],
    currency: Currency,
  ): Promise<CollectionEntry[]> {
    await this.checkBinders(
      userId,
      entries.map((e) => e.binderId),
    );
    const values = entries.map((e) => ({
      ...e,
      id: e.id ?? crypto.randomUUID(),
      userId,
      binderId: e.binderId ?? null,
      purchasePriceCents: e.purchasePriceCents ?? null,
      purchaseCurrency: e.purchaseCurrency ?? null,
      note: e.note ?? null,
    }));
    // Idempotent on the client's id: a retried POST writes nothing and answers the stored rows.
    await this.insert(
      () =>
        this.db
          .insert(collectionEntries)
          .values(values)
          .onConflictDoNothing({ target: collectionEntries.id }),
      'Print',
    );
    return this.entriesById(
      userId,
      values.map((v) => v.id),
      currency,
    );
  }

  async updateEntry(
    userId: string,
    id: string,
    patch: UpdateEntryRequest,
    currency: Currency,
  ): Promise<CollectionEntry> {
    await this.checkBinders(userId, [patch.binderId]);
    const [row] = await this.db
      .update(collectionEntries)
      .set({ ...patch, updatedAt: sql`now()` })
      .where(
        and(
          eq(collectionEntries.id, id),
          eq(collectionEntries.userId, userId),
          live(collectionEntries),
        ),
      )
      .returning({ id: collectionEntries.id });
    if (!row) throw notFound('Entry');
    const [entry] = await this.entriesById(userId, [id], currency);
    if (!entry) throw notFound('Entry');
    return entry;
  }

  async deleteEntry(userId: string, id: string): Promise<void> {
    const [row] = await this.db
      .update(collectionEntries)
      .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
      .where(
        and(
          eq(collectionEntries.id, id),
          eq(collectionEntries.userId, userId),
          live(collectionEntries),
        ),
      )
      .returning({ id: collectionEntries.id });
    if (!row) throw notFound('Entry');
  }

  // ---- wish list ----

  private wishQuery(where: SQL | undefined) {
    return this.db
      .select({ wish: wishlistEntries, ...this.printColumns })
      .from(wishlistEntries)
      .innerJoin(prints, eq(prints.id, wishlistEntries.printId))
      .innerJoin(cards, eq(cards.id, prints.cardId))
      .innerJoin(sets, eq(sets.id, prints.setId))
      .leftJoin(
        localized,
        and(eq(localized.printId, prints.id), eq(localized.lang, wishlistEntries.language)),
      )
      .leftJoin(english, and(eq(english.printId, prints.id), eq(english.lang, 'en')))
      .where(where);
  }

  private async pricedWishes(
    rows: Awaited<ReturnType<DrizzleCollectionStore['wishQuery']>>,
    currency: Currency,
  ): Promise<WishlistEntry[]> {
    const ctx = await this.prices(rows.map((r) => r.printId));
    return rows.map((r) => {
      const w = r.wish;
      const minCondition = w.minCondition as CollectionCondition | null;
      return {
        id: w.id,
        printId: w.printId,
        quantity: w.quantity,
        language: w.language,
        finish: w.finish,
        minCondition,
        maxPriceCents: w.maxPriceCents,
        currency: w.currency as Currency | null,
        note: w.note,
        createdAt: w.createdAt.toISOString(),
        updatedAt: w.updatedAt.toISOString(),
        print: this.toPrint(r),
        price: this.priceOf(
          ctx,
          r,
          w.finish,
          minCondition ?? 'NM',
          (w.currency as Currency | null) ?? currency,
        ),
      };
    });
  }

  async listWishes(
    userId: string,
    query: WishlistQuery & { currency: Currency },
    pageSize: number,
  ): Promise<WishlistResponse> {
    const where = and(
      eq(wishlistEntries.userId, userId),
      live(wishlistEntries),
      query.game ? eq(sets.gameId, query.game) : undefined,
      query.set ? sql`lower(${sets.code}) = lower(${query.set})` : undefined,
      query.q ? this.search(query.q) : undefined,
    );
    const [rows, [total]] = await Promise.all([
      this.wishQuery(where)
        .orderBy(desc(wishlistEntries.createdAt), desc(wishlistEntries.id))
        .limit(pageSize)
        .offset((query.page - 1) * pageSize),
      this.db
        .select({ n: count() })
        .from(wishlistEntries)
        .innerJoin(prints, eq(prints.id, wishlistEntries.printId))
        .innerJoin(cards, eq(cards.id, prints.cardId))
        .innerJoin(sets, eq(sets.id, prints.setId))
        .where(where),
    ]);
    return {
      entries: await this.pricedWishes(rows, query.currency),
      page: query.page,
      pageSize,
      total: total?.n ?? 0,
    };
  }

  private async wishesById(userId: string, ids: string[], currency: Currency) {
    const rows = await this.wishQuery(
      and(
        eq(wishlistEntries.userId, userId),
        live(wishlistEntries),
        inArray(wishlistEntries.id, ids),
      ),
    );
    const wishes = await this.pricedWishes(rows, currency);
    const byId = new Map(wishes.map((w) => [w.id, w]));
    return ids.flatMap((id) => byId.get(id) ?? []);
  }

  private async wishWrite<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await this.insert(write, 'Print');
    } catch (err) {
      if (pgCode(err) === '23505')
        throw new HTTPException(409, { message: 'That card is on the wish list already' });
      throw err;
    }
  }

  async createWishes(
    userId: string,
    wishes: NewWishData[],
    currency: Currency,
  ): Promise<WishlistEntry[]> {
    const values = wishes.map((w) => ({
      ...w,
      id: w.id ?? crypto.randomUUID(),
      userId,
      language: w.language ?? null,
      finish: w.finish ?? null,
      minCondition: w.minCondition ?? null,
      maxPriceCents: w.maxPriceCents ?? null,
      currency: w.currency ?? null,
      note: w.note ?? null,
    }));
    await this.wishWrite(() =>
      this.db
        .insert(wishlistEntries)
        .values(values)
        .onConflictDoNothing({ target: wishlistEntries.id }),
    );
    return this.wishesById(
      userId,
      values.map((v) => v.id),
      currency,
    );
  }

  async updateWish(
    userId: string,
    id: string,
    patch: UpdateWishRequest,
    currency: Currency,
  ): Promise<WishlistEntry> {
    const [row] = await this.wishWrite(() =>
      this.db
        .update(wishlistEntries)
        .set({ ...patch, updatedAt: sql`now()` })
        .where(
          and(
            eq(wishlistEntries.id, id),
            eq(wishlistEntries.userId, userId),
            live(wishlistEntries),
          ),
        )
        .returning({ id: wishlistEntries.id }),
    );
    if (!row) throw notFound('Wish');
    const [wish] = await this.wishesById(userId, [id], currency);
    if (!wish) throw notFound('Wish');
    return wish;
  }

  async deleteWish(userId: string, id: string): Promise<void> {
    const [row] = await this.db
      .update(wishlistEntries)
      .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
      .where(
        and(eq(wishlistEntries.id, id), eq(wishlistEntries.userId, userId), live(wishlistEntries)),
      )
      .returning({ id: wishlistEntries.id });
    if (!row) throw notFound('Wish');
  }

  // ---- summary, owned, export ----

  /**
   * Every live entry and wish with its price, summed in core (`valueOf`). ponytail: one pass in
   * memory over the whole collection, fine to tens of thousands of entries; aggregate in SQL
   * (or keep running totals) when collections grow past that.
   */
  async summary(userId: string, currency: Currency): Promise<CollectionSummary> {
    const userPrints = (table: typeof collectionEntries | typeof wishlistEntries) =>
      sql`select ${table.printId} from ${table} where ${table.userId} = ${userId} and ${table.deletedAt} is null`;
    const [entries, wishes, ctxEntries, ctxWishes] = await Promise.all([
      this.db
        .select({
          printId: collectionEntries.printId,
          binderId: collectionEntries.binderId,
          quantity: collectionEntries.quantity,
          condition: collectionEntries.condition,
          finish: collectionEntries.finish,
          game: sets.gameId,
          finishes: prints.finishes,
        })
        .from(collectionEntries)
        .innerJoin(prints, eq(prints.id, collectionEntries.printId))
        .innerJoin(sets, eq(sets.id, prints.setId))
        .where(and(eq(collectionEntries.userId, userId), live(collectionEntries))),
      this.db
        .select({
          printId: wishlistEntries.printId,
          quantity: wishlistEntries.quantity,
          minCondition: wishlistEntries.minCondition,
          finish: wishlistEntries.finish,
          maxPriceCents: wishlistEntries.maxPriceCents,
          currency: wishlistEntries.currency,
          game: sets.gameId,
          finishes: prints.finishes,
        })
        .from(wishlistEntries)
        .innerJoin(prints, eq(prints.id, wishlistEntries.printId))
        .innerJoin(sets, eq(sets.id, prints.setId))
        .where(and(eq(wishlistEntries.userId, userId), live(wishlistEntries))),
      this.prices(userPrints(collectionEntries)),
      this.prices(userPrints(wishlistEntries)),
    ]);
    const valued = entries.map((e) => ({
      ...e,
      price: this.priceOf(ctxEntries, e, e.finish, e.condition as CollectionCondition, currency),
    }));
    const wished = wishes.map((w) => {
      const wishCurrency = (w.currency as Currency | null) ?? currency;
      const price = this.priceOf(
        ctxWishes,
        w,
        w.finish,
        (w.minCondition as CollectionCondition | null) ?? 'NM',
        wishCurrency,
      );
      return {
        ...w,
        price,
        inBudget: inBudget({ ...w, currency: w.currency as Currency | null, price }),
      };
    });
    const byGame = <T extends { game: string; quantity: number; price: EntryPrice | null }>(
      items: T[],
    ) => valueBy(items, (i) => i.game).map(({ key, value }) => ({ ...value, game: key as Game }));
    return {
      collection: {
        ...valueOf(valued),
        estimate: valued.some((e) => e.price && e.price.factor !== 1),
        games: byGame(valued),
        binders: valueBy(valued, (e) => e.binderId).map(({ key, value }) => ({
          ...value,
          binderId: key,
        })),
      },
      wishlist: {
        ...valueOf(wished),
        games: byGame(wished),
        inBudget: wished.filter((w) => w.inBudget).length,
      },
    };
  }

  async owned(userId: string, query: OwnedQuery): Promise<OwnedResponse> {
    // The prints asked for: a list of ids (card page) or every print of a set (set page).
    const prints_ =
      'printIds' in query
        ? sql`${sql.param(query.printIds)}::uuid[]`
        : sql`array(select ${prints.id} from ${prints} join ${sets} on ${sets.id} = ${prints.setId} where ${sets.gameId} = ${query.game} and lower(${sets.code}) = lower(${query.set}))`;
    const where = (table: typeof collectionEntries | typeof wishlistEntries) =>
      and(
        eq(table.userId, userId),
        isNull(table.deletedAt),
        sql`${table.printId} = any(${prints_})`,
      );
    const n = (table: typeof collectionEntries | typeof wishlistEntries) =>
      sql<number>`sum(${table.quantity})::int`;
    const [owned, wished] = await Promise.all([
      this.db
        .select({
          printId: collectionEntries.printId,
          finish: collectionEntries.finish,
          n: n(collectionEntries),
        })
        .from(collectionEntries)
        .where(where(collectionEntries))
        .groupBy(collectionEntries.printId, collectionEntries.finish),
      this.db
        .select({ printId: wishlistEntries.printId, n: n(wishlistEntries) })
        .from(wishlistEntries)
        .where(where(wishlistEntries))
        .groupBy(wishlistEntries.printId),
    ]);
    const total = (rows: { printId: string; n: number }[]) => {
      const out: Record<string, number> = {};
      for (const r of rows) out[r.printId] = (out[r.printId] ?? 0) + r.n;
      return out;
    };
    const byFinish: Record<string, Record<string, number>> = {};
    for (const r of owned) (byFinish[r.printId] ??= {})[r.finish] = r.n;
    return { owned: total(owned), byFinish, wished: total(wished) };
  }

  async *exportRows(userId: string): AsyncIterable<ExportRow[]> {
    // Keyset on the id: no offset scan, and no timestamp rounding (JS dates have ms, Postgres µs).
    const BATCH = 1000;
    let after: string | undefined;
    for (;;) {
      const rows = await this.db
        .select({
          id: collectionEntries.id,
          name: sql<string>`coalesce(${english.name}, ${cards.name})`,
          setCode: sets.code,
          number: prints.number,
          language: collectionEntries.language,
          condition: collectionEntries.condition,
          finish: collectionEntries.finish,
          quantity: collectionEntries.quantity,
        })
        .from(collectionEntries)
        .innerJoin(prints, eq(prints.id, collectionEntries.printId))
        .innerJoin(cards, eq(cards.id, prints.cardId))
        .innerJoin(sets, eq(sets.id, prints.setId))
        .leftJoin(english, and(eq(english.printId, prints.id), eq(english.lang, 'en')))
        .where(
          and(
            eq(collectionEntries.userId, userId),
            live(collectionEntries),
            after ? gt(collectionEntries.id, after) : undefined,
          ),
        )
        .orderBy(asc(collectionEntries.id))
        .limit(BATCH);
      if (rows.length) yield rows;
      after = rows.at(-1)?.id;
      if (!after || rows.length < BATCH) return;
    }
  }
}
