CREATE TABLE "image_sources_gone" (
	"url" text PRIMARY KEY NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"print_id" uuid,
	"lang" text
);
--> statement-breakpoint
-- VB-89: the VPS image mirror (docs/guides/database-vps.md, section 11) records and clears the
-- gone URLs. The role exists only on the VPS; the API role gets the table by default privileges.
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'voidbinder_mirror') THEN
    GRANT SELECT, INSERT, DELETE ON "image_sources_gone" TO voidbinder_mirror;
  END IF;
END $$;
