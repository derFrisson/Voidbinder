import {
  analyzeDeck,
  cheapestPrice,
  deckGroup,
  deckLimit,
  deckStat,
  missingCards,
  priceEntry,
  printNumbers,
  valueOf,
  type DeckCard,
  type DeckReadOptions,
  type DeckStore,
  type DeckStat,
  type PrintPrices,
} from '@voidbinder/core';
import type { CardFormat, Game } from '@voidbinder/shared';
import {
  DECK_FORMATS,
  DECK_ZONES,
  type CreateDeckData,
  type Currency,
  type DeckDetail,
  type DeckEntry,
  type DeckEntryInput,
  type DeckGame,
  type DeckSummary,
  type DeckZone,
  type EntryPrice,
  type PriceSource,
  type UpdateDeckRequest,
} from '@voidbinder/shared/api';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { HTTPException } from 'hono/http-exception';
import {
  cards,
  collectionEntries,
  deckEntries,
  decks,
  games as catalogGames,
  pricesCurrent,
  printLocalizations,
  prints,
  sets,
} from '../../db/schema';
import { clearDeletions, logDeletions } from './drizzle-collection-store';

type DeckRow = typeof decks.$inferSelect;
type Ids = Record<string, unknown>;

const notFound = (what: string) => new HTTPException(404, { message: `${what} not found` });
const badRequest = (message: string) => new HTTPException(400, { message });

const formatsOf = (game: DeckGame) => DECK_FORMATS[game] as readonly string[];

/** A print of a deck card with what the list shows and its current prices. */
type PrintRow = PrintPrices & {
  cardId: string;
  setCode: string;
  number: string;
  displayNumber: string;
  displayCode: string;
  cardFormat: CardFormat;
  rarity: string | null;
  imageKey: string | null;
  externalIds: Ids;
};

/**
 * A deck list the game allows: zones the game has, cards of the game, prints of their card.
 * Throws 400 (zone) and 404 (card, print). Shared by `PUT /decks/:id/entries` and `/sync/push`.
 */
export async function checkDeckEntries(
  tx: Pick<NodePgDatabase, 'select'>,
  game: DeckGame,
  entries: readonly DeckEntryInput[],
): Promise<void> {
  const zones = DECK_ZONES[game] as readonly string[];
  const bad = entries.find((e) => !zones.includes(e.zone));
  if (bad) throw badRequest(`A ${game} deck has no ${bad.zone} zone`);

  // Every card of the deck's game, every print of its card.
  const cardIds = [...new Set(entries.map((e) => e.cardId))];
  const printIds = [...new Set(entries.flatMap((e) => (e.printId ? [e.printId] : [])))];
  const [known, knownPrints] = await Promise.all([
    cardIds.length
      ? tx
          .select({ id: cards.id })
          .from(cards)
          .where(and(inArray(cards.id, cardIds), eq(cards.gameId, game)))
      : [],
    printIds.length
      ? tx
          .select({ id: prints.id, cardId: prints.cardId })
          .from(prints)
          .where(inArray(prints.id, printIds))
      : [],
  ]);
  if (known.length !== cardIds.length) throw notFound('Card');
  const printCard = new Map(knownPrints.map((p) => [p.id, p.cardId]));
  if (entries.some((e) => e.printId && printCard.get(e.printId) !== e.cardId))
    throw notFound('Print');
}

/**
 * Decks in PostgreSQL (VB-34) on the cache-disabled pool (a user reads their own writes). Every
 * read runs the rules of `@voidbinder/core` over the deck's cards, the user's collection (copies
 * per card name in the deck's game, every binder) and the current prices. Throws 404 and 400 as
 * HTTPExceptions.
 */
export class DrizzleDeckStore implements DeckStore {
  constructor(
    private readonly db: NodePgDatabase,
    private readonly imageBaseUrl = '',
  ) {}

  /**
   * The R2 copy of the print, else Scryfall's image (VB-57). ponytail: the gist of the card and
   * collection stores' private `imageUrl`, without the localized image; share it in a follow-up.
   */
  private imageUrl(p: { imageKey: string | null; externalIds: Ids }): string | null {
    if (p.imageKey && this.imageBaseUrl) return `${this.imageBaseUrl}/${p.imageKey}`;
    return (p.externalIds.scryfall_images as { normal?: string } | undefined)?.normal ?? null;
  }

  private async deckRow(userId: string, id: string): Promise<DeckRow> {
    const [row] = await this.db
      .select()
      .from(decks)
      .where(and(eq(decks.id, id), eq(decks.userId, userId)));
    if (!row) throw notFound('Deck');
    return row;
  }

  /**
   * The rules' verdict, the entries as the list shows them and the comparison with the
   * collection, for any number of the user's decks in one set of queries. ponytail: reads every
   * print and price of every card in those decks (a basic land has hundreds of prints), fine for a
   * user's handful of decks; pick the cheapest print in SQL when deck lists grow.
   */
  private async analyze(userId: string, rows: DeckRow[], opts: DeckReadOptions) {
    const deckIds = rows.map((r) => r.id);
    const entryRows = deckIds.length
      ? await this.db
          .select({
            deckId: deckEntries.deckId,
            cardId: deckEntries.cardId,
            printId: deckEntries.printId,
            zone: deckEntries.zone,
            quantity: deckEntries.quantity,
            game: cards.gameId,
            name: cards.name,
            typeLine: cards.typeLine,
            text: cards.text,
            attributes: cards.attributes,
            legalities: cards.legalities,
          })
          .from(deckEntries)
          .innerJoin(cards, eq(cards.id, deckEntries.cardId))
          .where(inArray(deckEntries.deckId, deckIds))
          .orderBy(asc(cards.name))
      : [];
    const cardIds = [...new Set(entryRows.map((e) => e.cardId))];
    const names = [...new Set(entryRows.map((e) => e.name))];
    const games = [...new Set(rows.map((r) => r.gameId))];
    const pokemonNames = [
      ...new Set(entryRows.filter((e) => e.game === 'pokemon').map((e) => e.name)),
    ];

    const [printRows, priceRows, localRows, ownedRows, [total], pokemonRows] = await Promise.all([
      cardIds.length
        ? this.db
            .select({
              printId: prints.id,
              cardId: prints.cardId,
              setCode: sets.code,
              number: prints.number,
              game: sets.gameId,
              cardCount: sets.cardCount,
              cardFormat: catalogGames.cardFormat,
              localized: sql<boolean>`exists (select 1 from ${printLocalizations} where ${printLocalizations.printId} = ${prints.id} and ${printLocalizations.lang} = ${opts.lang})`,
              rarity: prints.rarity,
              finishes: prints.finishes,
              imageKey: prints.imageKey,
              externalIds: prints.externalIds,
            })
            .from(prints)
            .innerJoin(sets, eq(sets.id, prints.setId))
            .innerJoin(catalogGames, eq(catalogGames.id, sets.gameId))
            .where(inArray(prints.cardId, cardIds))
            .orderBy(desc(sets.releasedOn), asc(prints.number))
        : [],
      cardIds.length
        ? this.db
            .select({
              printId: pricesCurrent.printId,
              source: pricesCurrent.source,
              finish: pricesCurrent.finish,
              currency: pricesCurrent.currency,
              market: pricesCurrent.centsMarket,
              observedAt: pricesCurrent.observedAt,
            })
            .from(pricesCurrent)
            .innerJoin(prints, eq(prints.id, pricesCurrent.printId))
            .where(inArray(prints.cardId, cardIds))
        : [],
      // The card's name in the user's language, from any of its prints.
      cardIds.length && opts.lang !== 'en'
        ? this.db
            .selectDistinctOn([prints.cardId], {
              cardId: prints.cardId,
              name: printLocalizations.name,
            })
            .from(printLocalizations)
            .innerJoin(prints, eq(prints.id, printLocalizations.printId))
            .where(and(inArray(prints.cardId, cardIds), eq(printLocalizations.lang, opts.lang)))
            .orderBy(prints.cardId)
        : [],
      // Copies per card name and game across the whole collection: any print counts.
      names.length
        ? this.db
            .select({
              game: cards.gameId,
              name: cards.name,
              n: sql<number>`sum(${collectionEntries.quantity})::int`,
            })
            .from(collectionEntries)
            .innerJoin(prints, eq(prints.id, collectionEntries.printId))
            .innerJoin(cards, eq(cards.id, prints.cardId))
            .where(
              and(
                eq(collectionEntries.userId, userId),
                inArray(cards.gameId, games),
                inArray(cards.name, names),
              ),
            )
            .groupBy(cards.gameId, cards.name)
        : [],
      this.db
        .select({ n: sql<number>`coalesce(sum(${collectionEntries.quantity}), 0)::int` })
        .from(collectionEntries)
        .where(eq(collectionEntries.userId, userId)),
      // Pokémon reprints are cards of their own: the legality of every card of the name (and
      // the same text: a Pokémon that only shares the name is a different card).
      pokemonNames.length
        ? this.db
            .select({ name: cards.name, text: cards.text, legalities: cards.legalities })
            .from(cards)
            .where(and(eq(cards.gameId, 'pokemon'), inArray(cards.name, pokemonNames)))
        : [],
    ]);

    const pricesByPrint = new Map<string, PrintPrices['prices'][number][]>();
    for (const p of priceRows) {
      const list = pricesByPrint.get(p.printId) ?? [];
      list.push({
        source: p.source as PriceSource,
        finish: p.finish,
        currency: p.currency as Currency,
        market: p.market,
        observedAt: p.observedAt.toISOString(),
      });
      pricesByPrint.set(p.printId, list);
    }
    const printsByCard = new Map<string, PrintRow[]>();
    const printById = new Map<string, PrintRow>();
    for (const p of printRows) {
      const row: PrintRow = {
        ...p,
        ...printNumbers({ ...p, game: p.game as Game }, opts.lang, p.localized),
        cardFormat: p.cardFormat as CardFormat,
        prices: pricesByPrint.get(p.printId) ?? [],
      };
      printById.set(p.printId, row);
      const list = printsByCard.get(p.cardId) ?? [];
      list.push(row);
      printsByCard.set(p.cardId, list);
    }
    // Per name plus text and format: legal when any print of the same card is.
    const sameCard = (name: string, text: string | null) => `${name}\u0000${text ?? ''}`;
    const pokemonLegal = new Map<string, Record<string, string>>();
    for (const r of pokemonRows) {
      const key = sameCard(r.name, r.text);
      const merged = pokemonLegal.get(key) ?? {};
      for (const [format, status] of Object.entries(r.legalities))
        if (merged[format] !== 'legal') merged[format] = status;
      pokemonLegal.set(key, merged);
    }
    const localName = new Map(localRows.map((l) => [l.cardId, l.name]));
    const owned = new Map(ownedRows.map((o) => [`${o.game}:${o.name}`, o.n]));
    const cheapest = new Map(
      cardIds.map((id) => [id, cheapestPrice(printsByCard.get(id) ?? [], opts.currency)]),
    );

    return rows.map((deck) => {
      const game = deck.gameId as DeckGame;
      const lines = entryRows.filter((e) => e.deckId === deck.id);
      const deckCards: (DeckCard & { printId: string | null })[] = lines.map((e) => ({
        cardId: e.cardId,
        printId: e.printId,
        name: e.name,
        label: localName.get(e.cardId) ?? e.name,
        typeLine: e.typeLine,
        text: e.text,
        // The print's rarity (Pokémon's ACE SPEC, Prism Star) for the rules.
        attributes: {
          rarity: printsByCard.get(e.cardId)?.[0]?.rarity ?? null,
          ...e.attributes,
        },
        legalities:
          (game === 'pokemon' && pokemonLegal.get(sameCard(e.name, e.text))) || e.legalities,
        zone: e.zone as DeckZone,
        quantity: e.quantity,
      }));
      const verdict = analyzeDeck(game, deck.format, deckCards);

      const entries: DeckEntry[] = deckCards.map((c) => {
        const best = cheapest.get(c.cardId) ?? null;
        // The preferred print, else the cheapest, else the newest.
        const shown =
          (c.printId && printById.get(c.printId)) ||
          (best && printById.get(best.printId)) ||
          printsByCard.get(c.cardId)?.[0];
        const price: EntryPrice | null =
          shown && best?.printId === shown.printId
            ? best.price
            : shown
              ? priceEntry(shown.prices, {
                  currency: opts.currency,
                  finishes: shown.finishes,
                  condition: 'NM',
                })
              : null;
        const stat: DeckStat | null = deckStat(game, c);
        const limit = deckLimit(game, c, deck.format);
        return {
          cardId: c.cardId,
          printId: c.printId,
          zone: c.zone,
          quantity: c.quantity,
          name: c.label ?? c.name,
          typeLine: c.typeLine,
          group: deckGroup(game, c),
          stat,
          print: shown
            ? {
                id: shown.printId,
                setCode: shown.setCode,
                number: shown.number,
                displayNumber: shown.displayNumber,
                displayCode: shown.displayCode,
                cardFormat: shown.cardFormat,
                imageUrl: this.imageUrl(shown),
              }
            : null,
          owned: owned.get(`${game}:${c.name}`) ?? 0,
          limit: Number.isFinite(limit) ? limit : null,
          price,
        };
      });

      const missing = missingCards(
        deckCards.map((c) => {
          const best = cheapest.get(c.cardId) ?? null;
          // The priced print, else the preferred one, else the newest: a wish needs a print.
          const print =
            (best && printById.get(best.printId)) ||
            (c.printId && printById.get(c.printId)) ||
            printsByCard.get(c.cardId)?.[0];
          return {
            cardId: c.cardId,
            name: c.name,
            label: c.label ?? c.name,
            quantity: c.quantity,
            print: print
              ? {
                  id: print.printId,
                  setCode: print.setCode,
                  number: print.number,
                  displayCode: print.displayCode,
                }
              : null,
            price: best?.price ?? null,
          };
        }),
        new Map(
          [...owned].flatMap(([key, n]) =>
            key.startsWith(`${game}:`) ? [[key.slice(game.length + 1), n]] : [],
          ),
        ),
      );

      const detail: DeckDetail = {
        ...this.toDeck(deck),
        entries,
        analysis: {
          ...verdict,
          missing: missing.missing,
          missingValue: missing.value,
          value: valueOf(entries),
          collectionCards: total?.n ?? 0,
        },
      };
      return detail;
    });
  }

  private toDeck(r: DeckRow) {
    return {
      id: r.id,
      game: r.gameId as DeckGame,
      name: r.name,
      format: r.format,
      description: r.description,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  private async detail(userId: string, row: DeckRow, opts: DeckReadOptions) {
    const [detail] = await this.analyze(userId, [row], opts);
    if (!detail) throw notFound('Deck');
    return detail;
  }

  async list(userId: string, opts: DeckReadOptions): Promise<DeckSummary[]> {
    const rows = await this.db
      .select()
      .from(decks)
      .where(eq(decks.userId, userId))
      .orderBy(desc(decks.updatedAt), desc(decks.id));
    return (await this.analyze(userId, rows, opts)).map(({ entries, analysis, ...deck }) => ({
      ...deck,
      valid: analysis.valid,
      problems: analysis.problems.length,
      cards: entries.filter((e) => e.zone === 'main').reduce((n, e) => n + e.quantity, 0),
      missing: analysis.missing.reduce((n, m) => n + m.needed - m.owned, 0),
      value: analysis.value,
    }));
  }

  async get(userId: string, id: string, opts: DeckReadOptions): Promise<DeckDetail> {
    return this.detail(userId, await this.deckRow(userId, id), opts);
  }

  async create(userId: string, req: CreateDeckData, opts: DeckReadOptions): Promise<DeckDetail> {
    const id = req.id ?? crypto.randomUUID();
    // Idempotent on the client's id: a retried POST writes nothing and answers the stored deck.
    await this.db.transaction(async (tx) => {
      const added = await tx
        .insert(decks)
        .values({
          id,
          userId,
          gameId: req.game,
          name: req.name,
          format: req.format,
          description: req.description ?? null,
        })
        .onConflictDoNothing({ target: decks.id })
        .returning({ id: decks.id });
      // Written again under a deleted deck's id: that delete no longer stands.
      await clearDeletions(
        tx,
        userId,
        'decks',
        added.map((r) => r.id),
      );
    });
    const [row] = await this.db
      .select()
      .from(decks)
      .where(and(eq(decks.id, id), eq(decks.userId, userId)));
    // The id is another user's: nothing was written.
    if (!row) throw new HTTPException(409, { message: 'Deck id taken' });
    return this.detail(userId, row, opts);
  }

  async update(
    userId: string,
    id: string,
    patch: UpdateDeckRequest,
    opts: DeckReadOptions,
  ): Promise<DeckDetail> {
    const deck = await this.deckRow(userId, id);
    if (patch.format !== undefined && !formatsOf(deck.gameId as DeckGame).includes(patch.format))
      throw badRequest('Unknown format for this game');
    const [row] = await this.db
      .update(decks)
      .set({ ...patch, updatedAt: sql`now()` })
      .where(and(eq(decks.id, id), eq(decks.userId, userId)))
      .returning();
    if (!row) throw notFound('Deck');
    return this.detail(userId, row, opts);
  }

  /** Removes the deck with its entries (cascade) and logs the deck only. */
  async delete(userId: string, id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const rows = await tx
        .delete(decks)
        .where(and(eq(decks.id, id), eq(decks.userId, userId)))
        .returning({ id: decks.id });
      if (!rows.length) throw notFound('Deck');
      await logDeletions(tx, userId, 'decks', rows);
    });
  }

  async putEntries(
    userId: string,
    id: string,
    entries: DeckEntryInput[],
    opts: DeckReadOptions,
  ): Promise<DeckDetail> {
    const row = await this.db.transaction(async (tx) => {
      // Locks the deck: two lists written at once end as one of them, never mixed.
      const [deck] = await tx
        .select()
        .from(decks)
        .where(and(eq(decks.id, id), eq(decks.userId, userId)))
        .for('update');
      if (!deck) throw notFound('Deck');
      await checkDeckEntries(tx, deck.gameId as DeckGame, entries);

      await tx.delete(deckEntries).where(eq(deckEntries.deckId, id));
      if (entries.length)
        await tx.insert(deckEntries).values(
          entries.map((e) => ({
            deckId: id,
            cardId: e.cardId,
            printId: e.printId ?? null,
            zone: e.zone,
            quantity: e.quantity,
          })),
        );
      const [updated] = await tx
        .update(decks)
        .set({ updatedAt: sql`now()` })
        .where(eq(decks.id, id))
        .returning();
      return updated ?? deck;
    });
    return this.detail(userId, row, opts);
  }
}
