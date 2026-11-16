ALTER TABLE "orders" ADD COLUMN "order_no" integer NOT NULL GENERATED ALWAYS AS IDENTITY (sequence name "orders_order_no_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1001 CACHE 1);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "slip_key" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "slip_mime" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "slip_size_bytes" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "slip_uploaded_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "mt5_accounts_number_idx" ON "mt5_accounts" USING btree ("account_number");--> statement-breakpoint
CREATE INDEX "mt5_accounts_user_idx" ON "mt5_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_order_no_idx" ON "orders" USING btree ("order_no");--> statement-breakpoint
CREATE INDEX "orders_user_idx" ON "orders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_open_per_account_idx" ON "orders" USING btree ("mt5_account_id") WHERE "orders"."status" in ('pending_payment','awaiting_review');--> statement-breakpoint
ALTER TABLE "mt5_accounts" ADD CONSTRAINT "mt5_accounts_number_digits" CHECK ("mt5_accounts"."account_number" ~ '^[0-9]{1,20}$');