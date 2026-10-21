CREATE TABLE "product_variant_barcodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"variant_id" uuid NOT NULL,
	"barcode" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_variant_barcodes_variant_barcode_unique" UNIQUE("variant_id","barcode")
);
--> statement-breakpoint
CREATE TABLE "product_slug_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"slug" text NOT NULL,
	"is_canonical" boolean DEFAULT false NOT NULL,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_slug_aliases_locale_slug_unique" UNIQUE("locale","slug"),
	CONSTRAINT "product_slug_aliases_locale_check" CHECK ("product_slug_aliases"."locale" in ('ru', 'ro'))
);
--> statement-breakpoint
CREATE TABLE "inventory_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name_ru" text,
	"name_ro" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_locations_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "variant_inventory_by_location" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"variant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "variant_inventory_by_location_variant_location_unique" UNIQUE("variant_id","location_id"),
	CONSTRAINT "variant_inventory_by_location_quantity_non_negative_check" CHECK ("variant_inventory_by_location"."quantity" >= 0)
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "short_description_ru" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "short_description_ro" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "ingredients_ru" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "ingredients_ro" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "instructions_ru" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "instructions_ro" text;--> statement-breakpoint
ALTER TABLE "product_variant_barcodes" ADD CONSTRAINT "product_variant_barcodes_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_slug_aliases" ADD CONSTRAINT "product_slug_aliases_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_inventory_by_location" ADD CONSTRAINT "variant_inventory_by_location_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_inventory_by_location" ADD CONSTRAINT "variant_inventory_by_location_location_id_inventory_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."inventory_locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_variant_barcodes_variant_id_idx" ON "product_variant_barcodes" USING btree ("variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_variant_barcodes_primary_barcode_unique_idx" ON "product_variant_barcodes" USING btree ("barcode") WHERE "product_variant_barcodes"."is_primary";--> statement-breakpoint
CREATE INDEX "product_slug_aliases_product_id_idx" ON "product_slug_aliases" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "variant_inventory_by_location_variant_id_idx" ON "variant_inventory_by_location" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "variant_inventory_by_location_location_id_idx" ON "variant_inventory_by_location" USING btree ("location_id");