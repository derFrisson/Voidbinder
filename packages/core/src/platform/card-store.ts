/**
 * The card catalog and collection database (PostgreSQL in production, ADR 0003).
 * Only the health check exists yet; the catalog ticket (VB-26) adds the queries.
 */
export interface CardStore {
  /** Resolves when the database answers a trivial query, rejects otherwise. */
  ping(): Promise<void>;
}
