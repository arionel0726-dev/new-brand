ALTER TABLE "inventory" DROP CONSTRAINT "inventory_quantity_non_negative_check";--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory" ADD COLUMN "quantity_on_hand" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory" ADD COLUMN "quantity_reserved" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "brands_is_active_idx" ON "brands" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "categories_is_active_idx" ON "categories" USING btree ("is_active");--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_quantity_on_hand_non_negative_check" CHECK ("inventory"."quantity_on_hand" >= 0);--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_quantity_reserved_non_negative_check" CHECK ("inventory"."quantity_reserved" >= 0);--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_quantity_reserved_lte_on_hand_check" CHECK ("inventory"."quantity_reserved" <= "inventory"."quantity_on_hand");--> statement-breakpoint
-- Carry over any existing stock counts before the old column is dropped in the next migration.
UPDATE "inventory" SET "quantity_on_hand" = "quantity";