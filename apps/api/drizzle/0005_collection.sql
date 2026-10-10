CREATE TABLE "binders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"name" text NOT NULL,
	"game_id" text,
	"position" integer DEFAULT 0 NOT NULL,
	"colour" text
);
--> statement-breakpoint
CREATE TABLE "collection_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"print_id" uuid NOT NULL,
	"binder_id" uuid,
	"quantity" integer NOT NULL,
	"language" text NOT NULL,
	"condition" text NOT NULL,
	"finish" text NOT NULL,
	"purchase_price_cents" integer,
	"purchase_currency" text,
	"note" text,
	CONSTRAINT "collection_entries_quantity_check" CHECK ("collection_entries"."quantity" > 0),
	CONSTRAINT "collection_entries_condition_check" CHECK ("collection_entries"."condition" in ('MT', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO')),
	CONSTRAINT "collection_entries_purchase_currency_check" CHECK ("collection_entries"."purchase_currency" in ('EUR', 'USD'))
);
--> statement-breakpoint
CREATE TABLE "wishlist_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"print_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"language" text,
	"finish" text,
	"min_condition" text,
	"max_price_cents" integer,
	"currency" text,
	"note" text,
	CONSTRAINT "wishlist_entries_quantity_check" CHECK ("wishlist_entries"."quantity" > 0),
	CONSTRAINT "wishlist_entries_min_condition_check" CHECK ("wishlist_entries"."min_condition" in ('MT', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO')),
	CONSTRAINT "wishlist_entries_currency_check" CHECK ("wishlist_entries"."currency" in ('EUR', 'USD'))
);
--> statement-breakpoint
ALTER TABLE "binders" ADD CONSTRAINT "binders_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "binders" ADD CONSTRAINT "binders_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_entries" ADD CONSTRAINT "collection_entries_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_entries" ADD CONSTRAINT "collection_entries_print_id_prints_id_fk" FOREIGN KEY ("print_id") REFERENCES "public"."prints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_entries" ADD CONSTRAINT "collection_entries_binder_id_binders_id_fk" FOREIGN KEY ("binder_id") REFERENCES "public"."binders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlist_entries" ADD CONSTRAINT "wishlist_entries_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlist_entries" ADD CONSTRAINT "wishlist_entries_print_id_prints_id_fk" FOREIGN KEY ("print_id") REFERENCES "public"."prints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "binders_user_id_name_live_key" ON "binders" USING btree ("user_id","name") WHERE "binders"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "collection_entries_user_id_print_id_idx" ON "collection_entries" USING btree ("user_id","print_id");--> statement-breakpoint
CREATE INDEX "collection_entries_binder_id_idx" ON "collection_entries" USING btree ("binder_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wishlist_entries_user_print_lang_finish_live_key" ON "wishlist_entries" USING btree ("user_id","print_id",coalesce("language", ''),coalesce("finish", '')) WHERE "wishlist_entries"."deleted_at" is null;