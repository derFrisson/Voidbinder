-- Hand-ordered (VB-103): prices per card language. Every existing row is an English price
-- (`en`); the keys take the language. On the VPS `prices_daily` is a hypertable with compressed
-- (columnstore) chunks: TimescaleDB allows adding a column with a constant default and swapping
-- the primary key there without converting chunks back to the rowstore (docs: "Altering
-- hypertables with columnstore enabled"; checked on timescaledb-ha pg18.6-ts2.30.2 with a
-- compressed chunk), so the same statements serve plain PostgreSQL and the hypertable.
ALTER TABLE "price_mappings" ADD COLUMN "lang" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "prices_current" ADD COLUMN "lang" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "prices_daily" ADD COLUMN "lang" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "price_mappings"
	DROP CONSTRAINT "price_mappings_print_id_source_finish_pk",
	ADD CONSTRAINT "price_mappings_print_id_source_finish_lang_pk" PRIMARY KEY("print_id","source","finish","lang"),
	DROP CONSTRAINT "price_mappings_source_external_id_finish_key",
	ADD CONSTRAINT "price_mappings_source_external_id_finish_lang_key" UNIQUE("source","external_id","finish","lang");--> statement-breakpoint
ALTER TABLE "prices_current"
	DROP CONSTRAINT "prices_current_print_id_finish_source_pk",
	ADD CONSTRAINT "prices_current_print_id_finish_source_lang_pk" PRIMARY KEY("print_id","finish","source","lang");--> statement-breakpoint
ALTER TABLE "prices_daily"
	DROP CONSTRAINT "prices_daily_print_id_finish_source_observed_at_pk",
	ADD CONSTRAINT "prices_daily_print_id_finish_source_lang_observed_at_pk" PRIMARY KEY("print_id","finish","source","lang","observed_at");
