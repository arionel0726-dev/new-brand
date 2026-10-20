CREATE TYPE "public"."discount_type" AS ENUM('percentage', 'fixed_amount');--> statement-breakpoint
CREATE TABLE "promotion_brands" (
	"promotion_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	CONSTRAINT "promotion_brands_promotion_id_brand_id_pk" PRIMARY KEY("promotion_id","brand_id")
);
--> statement-breakpoint
CREATE TABLE "promotion_categories" (
	"promotion_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	CONSTRAINT "promotion_categories_promotion_id_category_id_pk" PRIMARY KEY("promotion_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "promotion_excluded_products" (
	"promotion_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	CONSTRAINT "promotion_excluded_products_promotion_id_product_id_pk" PRIMARY KEY("promotion_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "promotion_products" (
	"promotion_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	CONSTRAINT "promotion_products_promotion_id_product_id_pk" PRIMARY KEY("promotion_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "promotions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"name_ru" text,
	"name_ro" text,
	"discount_type" "discount_type" NOT NULL,
	"percentage_value" integer,
	"fixed_amount" integer,
	"max_discount_amount" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"priority" integer DEFAULT 0 NOT NULL,
	"max_total_redemptions" integer,
	"redemption_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promotions_discount_value_check" CHECK (("promotions"."discount_type" = 'percentage' and "promotions"."percentage_value" between 1 and 100 and "promotions"."fixed_amount" is null)
				or ("promotions"."discount_type" = 'fixed_amount' and "promotions"."fixed_amount" > 0 and "promotions"."percentage_value" is null)),
	CONSTRAINT "promotions_max_discount_non_negative_check" CHECK ("promotions"."max_discount_amount" is null or "promotions"."max_discount_amount" >= 0),
	CONSTRAINT "promotions_date_range_check" CHECK ("promotions"."starts_at" is null or "promotions"."ends_at" is null or "promotions"."starts_at" <= "promotions"."ends_at"),
	CONSTRAINT "promotions_redemption_count_non_negative_check" CHECK ("promotions"."redemption_count" >= 0 and ("promotions"."max_total_redemptions" is null or "promotions"."redemption_count" <= "promotions"."max_total_redemptions"))
);
--> statement-breakpoint
CREATE TABLE "coupon_brands" (
	"coupon_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	CONSTRAINT "coupon_brands_coupon_id_brand_id_pk" PRIMARY KEY("coupon_id","brand_id")
);
--> statement-breakpoint
CREATE TABLE "coupon_categories" (
	"coupon_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	CONSTRAINT "coupon_categories_coupon_id_category_id_pk" PRIMARY KEY("coupon_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "coupon_products" (
	"coupon_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	CONSTRAINT "coupon_products_coupon_id_product_id_pk" PRIMARY KEY("coupon_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "coupons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"discount_type" "discount_type" NOT NULL,
	"percentage_value" integer,
	"fixed_amount" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"min_order_amount" integer,
	"max_total_uses" integer,
	"uses_count" integer DEFAULT 0 NOT NULL,
	"max_uses_per_customer" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupons_code_unique" UNIQUE("code"),
	CONSTRAINT "coupons_discount_value_check" CHECK (("coupons"."discount_type" = 'percentage' and "coupons"."percentage_value" between 1 and 100 and "coupons"."fixed_amount" is null)
				or ("coupons"."discount_type" = 'fixed_amount' and "coupons"."fixed_amount" > 0 and "coupons"."percentage_value" is null)),
	CONSTRAINT "coupons_min_order_amount_non_negative_check" CHECK ("coupons"."min_order_amount" is null or "coupons"."min_order_amount" >= 0),
	CONSTRAINT "coupons_date_range_check" CHECK ("coupons"."starts_at" is null or "coupons"."ends_at" is null or "coupons"."starts_at" <= "coupons"."ends_at"),
	CONSTRAINT "coupons_uses_count_non_negative_check" CHECK ("coupons"."uses_count" >= 0 and ("coupons"."max_total_uses" is null or "coupons"."uses_count" <= "coupons"."max_total_uses")),
	CONSTRAINT "coupons_max_uses_per_customer_positive_check" CHECK ("coupons"."max_uses_per_customer" is null or "coupons"."max_uses_per_customer" > 0)
);
--> statement-breakpoint
CREATE TABLE "coupon_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"coupon_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"user_id" uuid,
	"discount_amount" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupon_redemptions_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "coupon_redemptions_discount_amount_non_negative_check" CHECK ("coupon_redemptions"."discount_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "collection_products" (
	"collection_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "collection_products_collection_id_product_id_pk" PRIMARY KEY("collection_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title_ru" text NOT NULL,
	"title_ro" text NOT NULL,
	"description_ru" text,
	"description_ro" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collections_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "promotion_id" uuid;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "discount_amount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "promotion_discount_amount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "coupon_discount_amount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "coupon_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "coupon_code_snapshot" text;--> statement-breakpoint
ALTER TABLE "promotion_brands" ADD CONSTRAINT "promotion_brands_promotion_id_promotions_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."promotions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_brands" ADD CONSTRAINT "promotion_brands_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_categories" ADD CONSTRAINT "promotion_categories_promotion_id_promotions_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."promotions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_categories" ADD CONSTRAINT "promotion_categories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_excluded_products" ADD CONSTRAINT "promotion_excluded_products_promotion_id_promotions_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."promotions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_excluded_products" ADD CONSTRAINT "promotion_excluded_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_products" ADD CONSTRAINT "promotion_products_promotion_id_promotions_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."promotions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_products" ADD CONSTRAINT "promotion_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_brands" ADD CONSTRAINT "coupon_brands_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_brands" ADD CONSTRAINT "coupon_brands_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_categories" ADD CONSTRAINT "coupon_categories_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_categories" ADD CONSTRAINT "coupon_categories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_products" ADD CONSTRAINT "coupon_products_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_products" ADD CONSTRAINT "coupon_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_products" ADD CONSTRAINT "collection_products_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_products" ADD CONSTRAINT "collection_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "promotion_brands_brand_id_idx" ON "promotion_brands" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "promotion_categories_category_id_idx" ON "promotion_categories" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "promotion_excluded_products_product_id_idx" ON "promotion_excluded_products" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "promotion_products_product_id_idx" ON "promotion_products" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "promotions_is_active_idx" ON "promotions" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "coupon_brands_brand_id_idx" ON "coupon_brands" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "coupon_categories_category_id_idx" ON "coupon_categories" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "coupon_products_product_id_idx" ON "coupon_products" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "coupons_is_active_idx" ON "coupons" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "coupon_redemptions_coupon_id_idx" ON "coupon_redemptions" USING btree ("coupon_id");--> statement-breakpoint
CREATE INDEX "coupon_redemptions_user_id_idx" ON "coupon_redemptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "collection_products_product_id_idx" ON "collection_products" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "collections_is_active_idx" ON "collections" USING btree ("is_active");--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_promotion_id_promotions_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."promotions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_discount_non_negative_check" CHECK ("order_items"."discount_amount" >= 0);--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_discount_lte_line_total_check" CHECK ("order_items"."discount_amount" <= "order_items"."line_total");--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_promotion_consistency_check" CHECK ("order_items"."promotion_id" is not null or "order_items"."discount_amount" = 0);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_discount_breakdown_consistency_check" CHECK ("orders"."discount_amount" = "orders"."promotion_discount_amount" + "orders"."coupon_discount_amount");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_promotion_discount_non_negative_check" CHECK ("orders"."promotion_discount_amount" >= 0);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_coupon_discount_non_negative_check" CHECK ("orders"."coupon_discount_amount" >= 0);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_coupon_consistency_check" CHECK (("orders"."coupon_id" is null and "orders"."coupon_code_snapshot" is null and "orders"."coupon_discount_amount" = 0)
				or ("orders"."coupon_id" is not null and "orders"."coupon_code_snapshot" is not null));