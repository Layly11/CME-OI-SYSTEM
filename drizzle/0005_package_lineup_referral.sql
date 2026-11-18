ALTER TYPE "public"."package_code" ADD VALUE 'three_months';--> statement-breakpoint
ALTER TYPE "public"."package_code" ADD VALUE 'free_referral';--> statement-breakpoint
CREATE TABLE "referral_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"mt5_account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	CONSTRAINT "referral_claims_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "referral_claims_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "referral_claims_mt5_account_id_unique" UNIQUE("mt5_account_id"),
	CONSTRAINT "referral_claims_activation_consistent" CHECK (("referral_claims"."mt5_account_id" is null) = ("referral_claims"."activated_at" is null))
);
--> statement-breakpoint
ALTER TABLE "packages" ADD COLUMN "bonus_days" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "referral_code" text DEFAULT upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)) NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "referred_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "referral_claims" ADD CONSTRAINT "referral_claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_claims" ADD CONSTRAINT "referral_claims_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_claims" ADD CONSTRAINT "referral_claims_mt5_account_id_mt5_accounts_id_fk" FOREIGN KEY ("mt5_account_id") REFERENCES "public"."mt5_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_referred_by_user_id_users_id_fk" FOREIGN KEY ("referred_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "users_referred_by_idx" ON "users" USING btree ("referred_by_user_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_referral_code_unique" UNIQUE("referral_code");--> statement-breakpoint
ALTER TABLE "packages" ADD CONSTRAINT "packages_bonus_days_nonnegative" CHECK ("packages"."bonus_days" >= 0);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_not_self_referred" CHECK ("users"."referred_by_user_id" is null or "users"."referred_by_user_id" <> "users"."id");