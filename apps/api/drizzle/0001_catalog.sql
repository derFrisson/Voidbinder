CREATE TABLE "cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" text NOT NULL,
	"name" text NOT NULL,
	"oracle_key" text NOT NULL,
	"type_line" text,
	"text" text,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"legalities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_hash" text,
	"search" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(type_line, '') || ' ' || coalesce(text, ''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cards_game_id_oracle_key_key" UNIQUE("game_id","oracle_key")
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sort" smallint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"kind" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "print_localizations" (
	"print_id" uuid NOT NULL,
	"lang" text NOT NULL,
	"name" text NOT NULL,
	"text" text,
	"image_key" text,
	"external_ids" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"search" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(text, ''))) STORED,
	CONSTRAINT "print_localizations_print_id_lang_pk" PRIMARY KEY("print_id","lang")
);
--> statement-breakpoint
CREATE TABLE "prints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_id" uuid NOT NULL,
	"set_id" uuid NOT NULL,
	"number" text NOT NULL,
	"rarity" text,
	"finishes" text[] DEFAULT '{}'::text[] NOT NULL,
	"artist" text,
	"image_key" text,
	"external_ids" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"released_on" date,
	"source_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prints_set_id_number_key" UNIQUE("set_id","number")
);
--> statement-breakpoint
CREATE TABLE "set_localizations" (
	"set_id" uuid NOT NULL,
	"lang" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "set_localizations_set_id_lang_pk" PRIMARY KEY("set_id","lang")
);
--> statement-breakpoint
CREATE TABLE "sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"released_on" date,
	"card_count" integer,
	"kind" text,
	"external_ids" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"image_key" text,
	"source_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sets_game_id_code_key" UNIQUE("game_id","code")
);
--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_localizations" ADD CONSTRAINT "print_localizations_print_id_prints_id_fk" FOREIGN KEY ("print_id") REFERENCES "public"."prints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prints" ADD CONSTRAINT "prints_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prints" ADD CONSTRAINT "prints_set_id_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."sets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "set_localizations" ADD CONSTRAINT "set_localizations_set_id_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sets" ADD CONSTRAINT "sets_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cards_game_id_idx" ON "cards" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "cards_search_idx" ON "cards" USING gin ("search");--> statement-breakpoint
CREATE INDEX "print_localizations_search_idx" ON "print_localizations" USING gin ("search");--> statement-breakpoint
CREATE INDEX "prints_card_id_idx" ON "prints" USING btree ("card_id");--> statement-breakpoint
CREATE INDEX "prints_set_id_idx" ON "prints" USING btree ("set_id");--> statement-breakpoint
CREATE INDEX "prints_tcgplayer_idx" ON "prints" USING btree (("external_ids"->>'tcgplayer'));--> statement-breakpoint
CREATE INDEX "sets_game_id_idx" ON "sets" USING btree ("game_id");--> statement-breakpoint
-- Seed: the games the catalog knows (VB-26). `sort` orders them in the app.
INSERT INTO "games" ("id", "name", "sort") VALUES
	('mtg', 'Magic: The Gathering', 1),
	('pokemon', 'Pokémon', 2),
	('yugioh', 'Yu-Gi-Oh!', 3),
	('onepiece', 'One Piece Card Game', 4);
