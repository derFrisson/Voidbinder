CREATE TABLE "waitlist_signups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"locale" text NOT NULL,
	"status" text NOT NULL,
	"confirm_token_hash" text NOT NULL,
	"confirm_expires_at" timestamp with time zone NOT NULL,
	"consent_text_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"unsubscribed_at" timestamp with time zone,
	"last_confirmation_sent_at" timestamp with time zone,
	CONSTRAINT "waitlist_signups_email_unique" UNIQUE("email"),
	CONSTRAINT "waitlist_signups_confirm_token_hash_unique" UNIQUE("confirm_token_hash"),
	CONSTRAINT "waitlist_signups_status_check" CHECK ("waitlist_signups"."status" in ('pending', 'confirmed', 'unsubscribed')),
	CONSTRAINT "waitlist_signups_locale_check" CHECK ("waitlist_signups"."locale" in ('de', 'en'))
);
