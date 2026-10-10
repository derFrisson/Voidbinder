CREATE SEQUENCE "public"."sync_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
ALTER TABLE "binders" ADD COLUMN "sync_seq" bigint DEFAULT nextval('sync_seq') NOT NULL;--> statement-breakpoint
ALTER TABLE "collection_entries" ADD COLUMN "sync_seq" bigint DEFAULT nextval('sync_seq') NOT NULL;--> statement-breakpoint
ALTER TABLE "wishlist_entries" ADD COLUMN "sync_seq" bigint DEFAULT nextval('sync_seq') NOT NULL;--> statement-breakpoint
ALTER TABLE "deck_entries" ADD COLUMN "sync_seq" bigint DEFAULT nextval('sync_seq') NOT NULL;--> statement-breakpoint
ALTER TABLE "decks" ADD COLUMN "sync_seq" bigint DEFAULT nextval('sync_seq') NOT NULL;--> statement-breakpoint
CREATE INDEX "binders_user_id_sync_seq_idx" ON "binders" USING btree ("user_id","sync_seq");--> statement-breakpoint
CREATE INDEX "collection_entries_user_id_sync_seq_idx" ON "collection_entries" USING btree ("user_id","sync_seq");--> statement-breakpoint
CREATE INDEX "wishlist_entries_user_id_sync_seq_idx" ON "wishlist_entries" USING btree ("user_id","sync_seq");--> statement-breakpoint
CREATE INDEX "decks_user_id_sync_seq_idx" ON "decks" USING btree ("user_id","sync_seq");--> statement-breakpoint
-- Hand-written (VB-32, ADR 0005): every insert and update of a synced row takes the next
-- `sync_seq`, whoever writes it (the REST routes and `/sync/push` alike). First it takes a
-- shared per-user lock until the transaction ends; `GET /sync/pull` takes the same lock
-- exclusively, so it waits for every write of the user in flight and no row can commit later
-- with a number below the cursor it hands out.
CREATE FUNCTION "sync_stamp"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  uid text;
BEGIN
  IF TG_TABLE_NAME = 'deck_entries' THEN
    SELECT "user_id" INTO uid FROM "decks" WHERE "id" = NEW."deck_id";
  ELSE
    uid := NEW."user_id";
  END IF;
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('voidbinder.sync:' || uid, 0));
  NEW."sync_seq" := nextval('sync_seq');
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER "binders_sync_stamp" BEFORE INSERT OR UPDATE ON "binders" FOR EACH ROW EXECUTE FUNCTION "sync_stamp"();--> statement-breakpoint
CREATE TRIGGER "collection_entries_sync_stamp" BEFORE INSERT OR UPDATE ON "collection_entries" FOR EACH ROW EXECUTE FUNCTION "sync_stamp"();--> statement-breakpoint
CREATE TRIGGER "wishlist_entries_sync_stamp" BEFORE INSERT OR UPDATE ON "wishlist_entries" FOR EACH ROW EXECUTE FUNCTION "sync_stamp"();--> statement-breakpoint
CREATE TRIGGER "decks_sync_stamp" BEFORE INSERT OR UPDATE ON "decks" FOR EACH ROW EXECUTE FUNCTION "sync_stamp"();--> statement-breakpoint
CREATE TRIGGER "deck_entries_sync_stamp" BEFORE INSERT OR UPDATE ON "deck_entries" FOR EACH ROW EXECUTE FUNCTION "sync_stamp"();
