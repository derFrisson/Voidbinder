import type { Game } from '@voidbinder/shared';
import type {
  BanlistImpactQuery,
  BanlistImpactResponse,
  BanlistQuery,
  BanlistResponse,
  CardQuery,
  CardResponse,
  GameSummary,
  NewSetsResponse,
  PriceHistoryQuery,
  PriceHistoryResponse,
  PricesQuery,
  PrintPricesResponse,
  PrintResponse,
  SearchQuery,
  SearchResponse,
  SearchSuggestQuery,
  SearchSuggestResponse,
  SetPageQuery,
  SetPageResponse,
  SetSummary,
} from '@voidbinder/shared/api';

/**
 * The card catalog and collection database (PostgreSQL in production, ADR 0003). The catalog
 * reads may be served from a cache up to a few minutes old (ADR 0004); `catalogVersion` changes
 * after every successful import run.
 */
export interface CardStore {
  /** Resolves when the database answers a trivial query, rejects otherwise. */
  ping(): Promise<void>;
  /** `app_meta.catalog_version`, bumped by every successful import run. */
  catalogVersion(): Promise<string>;
  listGames(): Promise<GameSummary[]>;
  listSets(game: Game, lang: string): Promise<SetSummary[]>;
  /**
   * Sets new in the catalog, every game's (VB-83): released from `since` to `today` (UTC dates the
   * caller passes, so the query stays cacheable), or undated and first imported since `since`
   * (not with the game's first import).
   */
  listNewSets(lang: string, since: string, today: string): Promise<NewSetsResponse['sets']>;
  /** null when the set does not exist. */
  getSetPage(
    game: Game,
    code: string,
    query: SetPageQuery,
    pageSize: number,
  ): Promise<SetPageResponse | null>;
  getCard(id: string, query: CardQuery): Promise<CardResponse | null>;
  getPrint(id: string): Promise<PrintResponse | null>;
  /** Full-text search over card and localized print names and texts (VB-35). */
  search(query: SearchQuery, pageSize: number): Promise<SearchResponse>;
  /** Typeahead: set codes and numbers, sets, name prefixes, similar names (VB-79). */
  suggest(query: SearchSuggestQuery, limit: number): Promise<SearchSuggestResponse>;
  /** Current prices of a print with the display price and condition estimates; null: no print. */
  getPrintPrices(id: string, query: PricesQuery): Promise<PrintPricesResponse | null>;
  /**
   * Daily market prices of the `days` days before `today` (a UTC date the caller passes, so the
   * query stays cacheable), thinned to weekly before the last 180 days, per day in `lang` (else
   * `en`, else another); null when no such print.
   */
  getPriceHistory(
    id: string,
    query: PriceHistoryQuery,
    today: string,
  ): Promise<PriceHistoryResponse | null>;
  /**
   * The Yu-Gi-Oh! ban list of a format with its changes since `since` (a UTC date the caller
   * passes, so the query stays cacheable) (VB-81).
   */
  getBanlist(query: BanlistQuery, since: string): Promise<BanlistResponse>;
  /**
   * What of the user's collection and decks the ban list touches: cards changed since `since`,
   * deck lines over the list's limit. Reads fresh, never from the catalog cache.
   */
  banlistImpact(
    userId: string,
    query: BanlistImpactQuery,
    since: string,
  ): Promise<BanlistImpactResponse>;
  /**
   * True while an import run of `source` is `running` and started less than 6 h ago (an older
   * one is taken as dead). Reads fresh, never from the catalog cache.
   */
  importRunning(source: string): Promise<boolean>;
}
