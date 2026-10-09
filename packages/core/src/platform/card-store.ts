import type { Game } from '@voidbinder/shared';
import type {
  CardResponse,
  GameSummary,
  PrintResponse,
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
  /** null when the set does not exist. */
  getSetPage(
    game: Game,
    code: string,
    query: SetPageQuery,
    pageSize: number,
  ): Promise<SetPageResponse | null>;
  getCard(id: string): Promise<CardResponse | null>;
  getPrint(id: string): Promise<PrintResponse | null>;
  /**
   * True while an import run of `source` is `running` and started less than 6 h ago (an older
   * one is taken as dead). Reads fresh, never from the catalog cache.
   */
  importRunning(source: string): Promise<boolean>;
}
