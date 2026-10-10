CREATE TABLE "condition_multipliers" (
	"game_id" text NOT NULL,
	"condition" text NOT NULL,
	"factor" numeric(4, 3) NOT NULL,
	CONSTRAINT "condition_multipliers_game_id_condition_pk" PRIMARY KEY("game_id","condition"),
	CONSTRAINT "condition_multipliers_condition_check" CHECK ("condition_multipliers"."condition" in ('NM', 'EX', 'GD', 'LP', 'PL', 'PO'))
);
--> statement-breakpoint
CREATE TABLE "price_mappings" (
	"print_id" uuid NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"finish" text NOT NULL,
	"confidence" smallint NOT NULL,
	"method" text NOT NULL,
	"overridden_by" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_mappings_print_id_source_finish_pk" PRIMARY KEY("print_id","source","finish"),
	CONSTRAINT "price_mappings_source_external_id_finish_key" UNIQUE("source","external_id","finish"),
	CONSTRAINT "price_mappings_confidence_check" CHECK ("price_mappings"."confidence" between 0 and 100),
	CONSTRAINT "price_mappings_method_check" CHECK ("price_mappings"."method" in ('scryfall_id', 'number_match', 'name_match', 'manual'))
);
--> statement-breakpoint
CREATE TABLE "price_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"currency" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prices_current" (
	"print_id" uuid NOT NULL,
	"finish" text NOT NULL,
	"source" text NOT NULL,
	"currency" text NOT NULL,
	"cents_market" integer NOT NULL,
	"cents_low" integer,
	"cents_mid" integer,
	"cents_high" integer,
	"observed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "prices_current_print_id_finish_source_pk" PRIMARY KEY("print_id","finish","source")
);
--> statement-breakpoint
CREATE TABLE "prices_daily" (
	"observed_at" timestamp with time zone NOT NULL,
	"print_id" uuid NOT NULL,
	"finish" text NOT NULL,
	"source" text NOT NULL,
	"currency" text NOT NULL,
	"cents_market" integer NOT NULL,
	"cents_low" integer,
	"cents_high" integer,
	CONSTRAINT "prices_daily_print_id_finish_source_observed_at_pk" PRIMARY KEY("print_id","finish","source","observed_at")
);
--> statement-breakpoint
ALTER TABLE "condition_multipliers" ADD CONSTRAINT "condition_multipliers_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_mappings" ADD CONSTRAINT "price_mappings_print_id_prints_id_fk" FOREIGN KEY ("print_id") REFERENCES "public"."prints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_mappings" ADD CONSTRAINT "price_mappings_source_price_sources_id_fk" FOREIGN KEY ("source") REFERENCES "public"."price_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prices_current" ADD CONSTRAINT "prices_current_print_id_prints_id_fk" FOREIGN KEY ("print_id") REFERENCES "public"."prints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prices_current" ADD CONSTRAINT "prices_current_source_price_sources_id_fk" FOREIGN KEY ("source") REFERENCES "public"."price_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
INSERT INTO "price_sources" ("id", "name", "currency") VALUES
	('tcgplayer', 'TCGplayer (via TCGCSV)', 'USD'),
	('cardmarket', 'Cardmarket (via Scryfall)', 'EUR'),
	('tcgplayer_scryfall', 'TCGplayer (via Scryfall)', 'USD');
--> statement-breakpoint
-- Estimates of a condition's share of the near-mint price, the same for every game until real
-- per-condition prices exist. Never shown as an observed price.
INSERT INTO "condition_multipliers" ("game_id", "condition", "factor")
SELECT g.id, c.condition, c.factor FROM "games" g CROSS JOIN (VALUES
	('NM', 1.0), ('EX', 0.85), ('GD', 0.7), ('LP', 0.6), ('PL', 0.45), ('PO', 0.3)
) AS c(condition, factor);
--> statement-breakpoint
COMMENT ON TABLE "condition_multipliers" IS 'Estimated share of the NM price per condition, not observed prices';
--> statement-breakpoint
-- TimescaleDB only where the extension is installed (the VPS, docs/guides/database-vps.md); plain
-- PostgreSQL (CI, Docker) keeps prices_daily an ordinary table. Chunks of a month, compressed
-- (columnstore) after 30 days, segmented by print and source.
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
		EXECUTE $q$SELECT create_hypertable('prices_daily', by_range('observed_at', INTERVAL '1 month'))$q$;
		EXECUTE $q$ALTER TABLE prices_daily SET (
			timescaledb.enable_columnstore = true,
			timescaledb.segmentby = 'print_id, source',
			timescaledb.orderby = 'observed_at DESC'
		)$q$;
		EXECUTE $q$CALL add_columnstore_policy('prices_daily', after => INTERVAL '30 days')$q$;
		RAISE NOTICE 'prices_daily is a TimescaleDB hypertable with a columnstore policy';
	ELSE
		RAISE NOTICE 'timescaledb is not installed: prices_daily stays a plain table';
	END IF;
END $$;
