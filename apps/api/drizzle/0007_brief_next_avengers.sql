CREATE TYPE "public"."media_upload_status" AS ENUM('pending', 'completed', 'rejected');--> statement-breakpoint
CREATE TABLE "media_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"object_key" text NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"declared_file_size" integer NOT NULL,
	"status" "media_upload_status" DEFAULT 'pending' NOT NULL,
	"created_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"image_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_uploads_object_key_unique" UNIQUE("object_key")
);
--> statement-breakpoint
CREATE TABLE "media_pending_deletions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"object_key" text NOT NULL,
	"reason" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_attempt_at" timestamp with time zone,
	CONSTRAINT "media_pending_deletions_object_key_unique" UNIQUE("object_key")
);
--> statement-breakpoint
ALTER TABLE "product_images" ADD COLUMN "object_key" text;--> statement-breakpoint
ALTER TABLE "product_images" ADD COLUMN "mime_type" text;--> statement-breakpoint
ALTER TABLE "product_images" ADD COLUMN "file_size" integer;--> statement-breakpoint
ALTER TABLE "product_images" ADD COLUMN "width" integer;--> statement-breakpoint
ALTER TABLE "product_images" ADD COLUMN "height" integer;--> statement-breakpoint
ALTER TABLE "media_uploads" ADD CONSTRAINT "media_uploads_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_uploads" ADD CONSTRAINT "media_uploads_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_uploads" ADD CONSTRAINT "media_uploads_image_id_product_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."product_images"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_uploads" ADD CONSTRAINT "media_uploads_variant_product_fk" FOREIGN KEY ("variant_id","product_id") REFERENCES "public"."product_variants"("id","product_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_uploads_product_id_idx" ON "media_uploads" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "media_uploads_created_by_idx" ON "media_uploads" USING btree ("created_by");--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_object_key_unique" UNIQUE("object_key");