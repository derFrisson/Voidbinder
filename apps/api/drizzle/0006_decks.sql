CREATE TABLE "deck_entries" (
	"deck_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"print_id" uuid,
	"zone" text NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "deck_entries_deck_id_card_id_zone_pk" PRIMARY KEY("deck_id","card_id","zone"),
	CONSTRAINT "deck_entries_zone_check" CHECK ("deck_entries"."zone" in ('main', 'extra', 'side', 'commander')),
	CONSTRAINT "deck_entries_quantity_check" CHECK ("deck_entries"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "decks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"game_id" text NOT NULL,
	"name" text NOT NULL,
	"format" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "deck_entries" ADD CONSTRAINT "deck_entries_deck_id_decks_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."decks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck_entries" ADD CONSTRAINT "deck_entries_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck_entries" ADD CONSTRAINT "deck_entries_print_id_prints_id_fk" FOREIGN KEY ("print_id") REFERENCES "public"."prints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decks" ADD CONSTRAINT "decks_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decks" ADD CONSTRAINT "decks_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "decks_user_id_live_idx" ON "decks" USING btree ("user_id") WHERE "decks"."deleted_at" is null;