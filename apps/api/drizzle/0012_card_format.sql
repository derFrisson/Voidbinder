ALTER TABLE "games" ADD COLUMN "card_format" text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_card_format_check" CHECK ("games"."card_format" in ('standard', 'japanese'));--> statement-breakpoint
-- Hand-written (VB-97): Yu-Gi-Oh! cards are 59 × 86 mm (the Japanese size), the other games'
-- 63 × 88 mm stay `standard`. The seed in 0001 stays as it was.
UPDATE "games" SET "card_format" = 'japanese' WHERE "id" = 'yugioh';
