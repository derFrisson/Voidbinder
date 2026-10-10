-- VB-110: one TCGplayer product may price several prints (a Yu-Gi-Oh! `LOB-EN001` also prices
-- `LOB-001` and `LOB-E001`, method `region_match`), so the external id stops being unique; the
-- lookup by external id keeps its index.
ALTER TABLE "price_mappings" DROP CONSTRAINT "price_mappings_source_external_id_finish_lang_key";--> statement-breakpoint
ALTER TABLE "price_mappings" DROP CONSTRAINT "price_mappings_method_check";--> statement-breakpoint
CREATE INDEX "price_mappings_source_external_id_finish_lang_idx" ON "price_mappings" USING btree ("source","external_id","finish","lang");--> statement-breakpoint
ALTER TABLE "price_mappings" ADD CONSTRAINT "price_mappings_method_check" CHECK ("price_mappings"."method" in ('scryfall_id', 'number_match', 'region_match', 'name_match', 'manual'));