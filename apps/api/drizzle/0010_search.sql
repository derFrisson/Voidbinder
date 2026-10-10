-- Hand-written (VB-79): pg_trgm for name prefixes and typos, and the keys of the search's code
-- lookup. pg_trgm is a trusted extension, so the database owner (voidbinder_migrate) creates it.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
-- A set code as people type it: lower case, letters and digits only, no leading zeros in a digit
-- run (`SV01` → `sv1`, `sv03.5` → `sv35`, `LDS3` → `lds3`). The query side applies it to every
-- prefix of the normalized query, so `sv1 001` finds the set `sv01`.
CREATE FUNCTION "catalog_code_key"(code text) RETURNS text
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  RETURN regexp_replace(regexp_replace(lower(code), '[^a-z0-9]+', '', 'g'), '(^|[a-z])0+(?=[0-9])', '\1', 'g');--> statement-breakpoint
-- A collector number without separators, without a language or region prefix of one or two
-- letters and without leading zeros (`EN121` → `121`, `001` → `1`, `TG01` → `1`, `12a` → `12a`);
-- null when nothing is left. Matches `121`, `001/128` and `LDS3-DE121` against the stored number.
CREATE FUNCTION "catalog_number_key"(number text) RETURNS text
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  RETURN nullif(ltrim(regexp_replace(regexp_replace(lower(number), '[^a-z0-9]+', '', 'g'), '^[a-z]{1,2}(?=[0-9])', ''), '0'), '');--> statement-breakpoint
CREATE INDEX "cards_name_trgm_idx" ON "cards" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "print_localizations_name_trgm_idx" ON "print_localizations" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "prints_number_key_idx" ON "prints" USING btree (catalog_number_key("number"));--> statement-breakpoint
CREATE INDEX "sets_code_key_idx" ON "sets" USING btree (catalog_code_key("code"));--> statement-breakpoint
-- Statistics for the new expression indexes now, not at the next autovacuum: without them the
-- planner guesses and the code lookup takes 3 to 10 times longer.
ANALYZE "sets", "prints";
