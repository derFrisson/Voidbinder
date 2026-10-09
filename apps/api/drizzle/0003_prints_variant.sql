ALTER TABLE "prints" DROP CONSTRAINT "prints_set_id_number_key";--> statement-breakpoint
ALTER TABLE "prints" ADD COLUMN "variant" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "prints" ADD CONSTRAINT "prints_set_id_number_variant_key" UNIQUE("set_id","number","variant");