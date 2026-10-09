CREATE TABLE "app_meta" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Seed: bumped whenever the published catalog changes (ADR 0004 caching keys on it).
INSERT INTO "app_meta" ("key", "value") VALUES ('catalog_version', '0');
