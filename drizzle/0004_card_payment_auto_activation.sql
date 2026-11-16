CREATE TABLE "license_activations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"license_id" uuid NOT NULL,
	"mt5_account_id" uuid NOT NULL,
	"package_id" uuid NOT NULL,
	"duration_days" integer,
	"previous_expires_at" date,
	"new_expires_at" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "license_activations_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
ALTER TABLE "mt5_accounts" ADD COLUMN "partner_broker_code" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_provider" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_ref" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "partner_broker_code" text;--> statement-breakpoint
ALTER TABLE "license_activations" ADD CONSTRAINT "license_activations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "license_activations" ADD CONSTRAINT "license_activations_license_id_licenses_id_fk" FOREIGN KEY ("license_id") REFERENCES "public"."licenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "license_activations" ADD CONSTRAINT "license_activations_mt5_account_id_mt5_accounts_id_fk" FOREIGN KEY ("mt5_account_id") REFERENCES "public"."mt5_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "license_activations" ADD CONSTRAINT "license_activations_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "license_activations_license_idx" ON "license_activations" USING btree ("license_id");--> statement-breakpoint
CREATE UNIQUE INDEX "licenses_active_per_account_idx" ON "licenses" USING btree ("mt5_account_id") WHERE "licenses"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "orders_payment_ref_idx" ON "orders" USING btree ("payment_provider","payment_ref") WHERE "orders"."payment_ref" is not null;