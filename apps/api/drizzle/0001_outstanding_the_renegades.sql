ALTER TABLE "product_images" DROP CONSTRAINT "product_images_owner_check";--> statement-breakpoint
ALTER TABLE "categories" DROP CONSTRAINT "categories_parent_id_categories_id_fk";
--> statement-breakpoint
ALTER TABLE "product_images" DROP CONSTRAINT "product_images_variant_id_product_variants_id_fk";
--> statement-breakpoint
ALTER TABLE "product_images" ALTER COLUMN "product_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_id_product_id_unique" UNIQUE("id","product_id");--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_variant_product_fk" FOREIGN KEY ("variant_id","product_id") REFERENCES "public"."product_variants"("id","product_id") ON DELETE cascade ON UPDATE no action;