import type { SearchSuggestQuery, SearchSuggestResponse } from '@voidbinder/shared/api';

/** The typeahead's answer, with the `catalog_version` the index was copied at. */
export interface IndexedSuggestions {
  result: SearchSuggestResponse;
  catalogVersion: string;
}

/**
 * A read-only copy of the catalog's names and codes close to the user (VB-98, ADR 0006; D1 on
 * Cloudflare), in front of the `CardStore` typeahead. It answers null when it cannot answer
 * (never synced, stale); the caller then asks the `CardStore`, which stays the source of truth.
 * The full search stays with the `CardStore`: it matches card texts, which the index does not hold.
 */
export interface SearchIndex {
  /** The typeahead, ranked as `CardStore.suggest`. */
  suggest(query: SearchSuggestQuery, limit: number): Promise<IndexedSuggestions | null>;
}
