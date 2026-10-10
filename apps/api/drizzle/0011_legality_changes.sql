CREATE TABLE "legality_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_id" uuid NOT NULL,
	"format" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "legality_changes" ADD CONSTRAINT "legality_changes_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "legality_changes_format_seen_at_idx" ON "legality_changes" USING btree ("format","seen_at" DESC NULLS LAST);--> statement-breakpoint
-- Hand-written (VB-81): one row per format whose status an update of `cards.legalities` changes,
-- whichever importer writes it (YGOPRODeck's ban lists, Scryfall's and TCGdex's legalities). A
-- status that appears or disappears has a null on that side. Inserts (new cards) write nothing.
CREATE FUNCTION "record_legality_changes"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "legality_changes" ("card_id", "format", "from_status", "to_status")
  SELECT NEW."id", f.k, OLD."legalities" ->> f.k, NEW."legalities" ->> f.k
  FROM (
    SELECT jsonb_object_keys(OLD."legalities")
    UNION
    SELECT jsonb_object_keys(NEW."legalities")
  ) AS f(k)
  WHERE (OLD."legalities" ->> f.k) IS DISTINCT FROM (NEW."legalities" ->> f.k);
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE TRIGGER "cards_legality_changes" AFTER UPDATE OF "legalities" ON "cards" FOR EACH ROW
  WHEN (OLD."legalities" IS DISTINCT FROM NEW."legalities")
  EXECUTE FUNCTION "record_legality_changes"();
