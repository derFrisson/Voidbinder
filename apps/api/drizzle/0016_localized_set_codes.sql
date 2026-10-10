-- VB-94: a Yu-Gi-Oh! localization's code as printed in its language sits in
-- external_ids.set_code (`LON-G065`, `LDC-F065`); the search looks a typed code up by its
-- letters and digits in lower case, whatever set code it starts with.
CREATE INDEX "print_localizations_set_code_idx" ON "print_localizations" USING btree (regexp_replace(lower("external_ids" ->> 'set_code'), '[^a-z0-9]+', '', 'g')) WHERE "print_localizations"."external_ids" ? 'set_code';--> statement-breakpoint
-- Statistics for the new expression index now (as 0010_search.sql).
ANALYZE "print_localizations";
