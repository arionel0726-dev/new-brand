ALTER TABLE "product_variants" ADD COLUMN "barcode" text;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_barcode_unique_idx" ON "product_variants" USING btree ("barcode") WHERE "product_variants"."barcode" is not null;