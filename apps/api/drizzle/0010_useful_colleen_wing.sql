CREATE TYPE "public"."delivery_method" AS ENUM('pickup', 'courier');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('cash_on_delivery', 'card_on_delivery', 'online');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'requires_action', 'paid', 'failed', 'cancelled', 'refunded', 'partially_refunded');--> statement-breakpoint
CREATE TABLE "delivery_zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name_ru" text NOT NULL,
	"name_ro" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"fee_amount" integer NOT NULL,
	"min_order_amount" integer,
	"free_threshold_amount" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_zones_code_unique" UNIQUE("code"),
	CONSTRAINT "delivery_zones_fee_non_negative_check" CHECK ("delivery_zones"."fee_amount" >= 0),
	CONSTRAINT "delivery_zones_min_order_non_negative_check" CHECK ("delivery_zones"."min_order_amount" is null or "delivery_zones"."min_order_amount" >= 0),
	CONSTRAINT "delivery_zones_free_threshold_non_negative_check" CHECK ("delivery_zones"."free_threshold_amount" is null or "delivery_zones"."free_threshold_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "pickup_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name_ru" text NOT NULL,
	"name_ro" text NOT NULL,
	"address" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pickup_locations_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "payment_provider_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"external_event_id" text NOT NULL,
	"payment_id" uuid,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "payment_provider_events_provider_external_event_id_unique" UNIQUE("provider","external_event_id")
);
--> statement-breakpoint
CREATE TABLE "payment_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"from_status" "payment_status",
	"to_status" "payment_status" NOT NULL,
	"changed_by" uuid,
	"reason" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"method" "payment_method" NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"currency" text DEFAULT 'MDL' NOT NULL,
	"amount" integer NOT NULL,
	"refunded_amount" integer DEFAULT 0 NOT NULL,
	"provider" text NOT NULL,
	"external_reference" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_currency_check" CHECK ("payments"."currency" = 'MDL'),
	CONSTRAINT "payments_amount_non_negative_check" CHECK ("payments"."amount" >= 0),
	CONSTRAINT "payments_refunded_amount_non_negative_check" CHECK ("payments"."refunded_amount" >= 0),
	CONSTRAINT "payments_refunded_amount_lte_amount_check" CHECK ("payments"."refunded_amount" <= "payments"."amount"),
	CONSTRAINT "payments_refund_status_consistency_check" CHECK (("payments"."status" = 'refunded' and "payments"."refunded_amount" = "payments"."amount")
				or ("payments"."status" = 'partially_refunded' and "payments"."refunded_amount" > 0 and "payments"."refunded_amount" < "payments"."amount")
				or ("payments"."status" not in ('refunded', 'partially_refunded') and "payments"."refunded_amount" = 0))
);
--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "delivery_method" SET DATA TYPE "public"."delivery_method" USING "delivery_method"::"public"."delivery_method";--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "payment_method" SET DATA TYPE "public"."payment_method" USING "payment_method"::"public"."payment_method";--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "pickup_location_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_zone_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "recipient_name" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "recipient_phone" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_city" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_street" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_house" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_apartment" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_notes" text;--> statement-breakpoint
ALTER TABLE "payment_provider_events" ADD CONSTRAINT "payment_provider_events_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_status_history" ADD CONSTRAINT "payment_status_history_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_status_history" ADD CONSTRAINT "payment_status_history_changed_by_user_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_status_history_payment_id_idx" ON "payment_status_history" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "payments_order_id_idx" ON "payments" USING btree ("order_id");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_pickup_location_id_pickup_locations_id_fk" FOREIGN KEY ("pickup_location_id") REFERENCES "public"."pickup_locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_delivery_zone_id_delivery_zones_id_fk" FOREIGN KEY ("delivery_zone_id") REFERENCES "public"."delivery_zones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_delivery_shape_check" CHECK (
				("orders"."delivery_method" is null
					and "orders"."pickup_location_id" is null and "orders"."delivery_zone_id" is null
					and "orders"."recipient_name" is null and "orders"."recipient_phone" is null
					and "orders"."delivery_city" is null and "orders"."delivery_street" is null and "orders"."delivery_house" is null)
				or ("orders"."delivery_method" = 'pickup'
					and "orders"."pickup_location_id" is not null and "orders"."delivery_zone_id" is null
					and "orders"."recipient_name" is null and "orders"."recipient_phone" is null
					and "orders"."delivery_city" is null and "orders"."delivery_street" is null and "orders"."delivery_house" is null)
				or ("orders"."delivery_method" = 'courier'
					and "orders"."pickup_location_id" is null and "orders"."delivery_zone_id" is not null
					and "orders"."recipient_name" is not null and "orders"."recipient_phone" is not null
					and "orders"."delivery_city" is not null and "orders"."delivery_street" is not null and "orders"."delivery_house" is not null)
			);