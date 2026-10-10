CREATE TABLE "sync_deletions" (
	"user_id" text NOT NULL,
	"table" text NOT NULL,
	"id" uuid NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"logged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sync_seq" bigint DEFAULT nextval('sync_seq') NOT NULL,
	CONSTRAINT "sync_deletions_user_id_table_id_pk" PRIMARY KEY("user_id","table","id"),
	CONSTRAINT "sync_deletions_table_check" CHECK ("sync_deletions"."table" in ('binders', 'collection_entries', 'wishlist_entries', 'decks'))
);
--> statement-breakpoint
ALTER TABLE "sync_deletions" ADD CONSTRAINT "sync_deletions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sync_deletions_user_id_sync_seq_idx" ON "sync_deletions" USING btree ("user_id","sync_seq");--> statement-breakpoint
CREATE INDEX "sync_deletions_logged_at_idx" ON "sync_deletions" USING btree ("logged_at");--> statement-breakpoint
-- Hand-written (VB-75, ADR 0005): `sync_deletions` is stamped like the synced tables, by the same
-- function, so a logged delete takes the same shared per-user lock as every other write and
-- `GET /sync/pull` cannot hand out a cursor past one still in flight. The only change to
-- sync_stamp() of 0008_sync.sql is the `sync_deletions` branch (it has no `updated_at`).
CREATE OR REPLACE FUNCTION "sync_stamp"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  uid text;
BEGIN
  IF TG_TABLE_NAME = 'deck_entries' THEN
    SELECT "user_id" INTO uid FROM "decks" WHERE "id" = NEW."deck_id";
  ELSIF TG_TABLE_NAME = 'sync_deletions' THEN
    uid := NEW."user_id";
  ELSE
    uid := NEW."user_id";
    NEW."updated_at" := date_trunc('milliseconds', NEW."updated_at");
    IF TG_OP = 'UPDATE' THEN
      NEW."updated_at" := greatest(NEW."updated_at",
        date_trunc('milliseconds', OLD."updated_at") + interval '1 millisecond');
    END IF;
  END IF;
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('voidbinder.sync:' || uid, 0));
  NEW."sync_seq" := nextval('sync_seq');
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER "sync_deletions_sync_stamp" BEFORE INSERT OR UPDATE ON "sync_deletions" FOR EACH ROW EXECUTE FUNCTION "sync_stamp"();--> statement-breakpoint
-- Hand-written (VB-75): the rows deleted so far (tombstones) go now, each logged as a deletion so
-- devices still learn of it. Entries still filed in a deleted binder move out first.
INSERT INTO "sync_deletions" ("user_id", "table", "id", "deleted_at")
  SELECT "user_id", 'binders', "id", "deleted_at" FROM "binders" WHERE "deleted_at" IS NOT NULL
  UNION ALL
  SELECT "user_id", 'collection_entries', "id", "deleted_at" FROM "collection_entries" WHERE "deleted_at" IS NOT NULL
  UNION ALL
  SELECT "user_id", 'wishlist_entries', "id", "deleted_at" FROM "wishlist_entries" WHERE "deleted_at" IS NOT NULL
  UNION ALL
  SELECT "user_id", 'decks', "id", "deleted_at" FROM "decks" WHERE "deleted_at" IS NOT NULL;--> statement-breakpoint
UPDATE "collection_entries" SET "binder_id" = NULL, "updated_at" = now()
  WHERE "deleted_at" IS NULL AND "binder_id" IN (SELECT "id" FROM "binders" WHERE "deleted_at" IS NOT NULL);--> statement-breakpoint
DELETE FROM "collection_entries" WHERE "deleted_at" IS NOT NULL;--> statement-breakpoint
DELETE FROM "wishlist_entries" WHERE "deleted_at" IS NOT NULL;--> statement-breakpoint
DELETE FROM "decks" WHERE "deleted_at" IS NOT NULL;--> statement-breakpoint
DELETE FROM "binders" WHERE "deleted_at" IS NOT NULL;--> statement-breakpoint
-- With no deleted rows left, the unique rules hold for every row (pre-launch: the partial indexes
-- go in the same release).
CREATE UNIQUE INDEX "binders_user_id_name_key" ON "binders" USING btree ("user_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "wishlist_entries_user_print_lang_finish_key" ON "wishlist_entries" USING btree ("user_id","print_id",coalesce("language", ''),coalesce("finish", ''));--> statement-breakpoint
DROP INDEX "binders_user_id_name_live_key";--> statement-breakpoint
DROP INDEX "wishlist_entries_user_print_lang_finish_live_key";--> statement-breakpoint
-- Hand-written (VB-75): a push deletes a binder where it comes in the batch and moves the entries
-- still in it out at the end (an entry the same push files elsewhere keeps that move), so the
-- binder's foreign key may wait for the commit; `syncPush` defers it, every other write checks it
-- at once (INITIALLY IMMEDIATE).
ALTER TABLE "collection_entries" ALTER CONSTRAINT "collection_entries_binder_id_binders_id_fk" DEFERRABLE INITIALLY IMMEDIATE;
