CREATE TYPE "public"."external_entity_type" AS ENUM('product', 'product_variant', 'brand', 'category', 'nomenclature', 'nomenclature_group');--> statement-breakpoint
CREATE TYPE "public"."external_source_system" AS ENUM('legacy_mysql', '1c');--> statement-breakpoint
CREATE TYPE "public"."import_feed_type" AS ENUM('products', 'pricevn', 'jobvn_seo');--> statement-breakpoint
CREATE TYPE "public"."import_run_status" AS ENUM('pending', 'running', 'completed', 'partially_failed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."import_issue_code" AS ENUM('validation_failed', 'unmatched_brand', 'unmatched_category', 'duplicate_guid', 'duplicate_sku', 'missing_required_field', 'ambiguous_variant_parent', 'conflicting_external_mapping', 'invalid_price', 'malformed_stock_quantity', 'unexpected_record_structure', 'blank_value_would_overwrite_curated_value');--> statement-breakpoint
CREATE TYPE "public"."import_issue_severity" AS ENUM('info', 'warning', 'error');--> statement-breakpoint
CREATE TABLE "external_entity_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_system" "external_source_system" NOT NULL,
	"entity_type" "external_entity_type" NOT NULL,
	"external_id" text NOT NULL,
	"internal_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_entity_mappings_source_entity_external_unique" UNIQUE("source_system","entity_type","external_id"),
	CONSTRAINT "external_entity_mappings_external_id_non_empty_check" CHECK (length(trim("external_entity_mappings"."external_id")) > 0)
);
--> statement-breakpoint
CREATE TABLE "import_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_system" "external_source_system" NOT NULL,
	"feed_type" "import_feed_type" NOT NULL,
	"status" "import_run_status" DEFAULT 'pending' NOT NULL,
	"dry_run" boolean DEFAULT true NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"source_checksum" text NOT NULL,
	"source_version" text,
	"records_received" integer DEFAULT 0 NOT NULL,
	"records_created" integer DEFAULT 0 NOT NULL,
	"records_updated" integer DEFAULT 0 NOT NULL,
	"records_skipped" integer DEFAULT 0 NOT NULL,
	"records_rejected" integer DEFAULT 0 NOT NULL,
	"last_error_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_runs_records_non_negative_check" CHECK (
			"import_runs"."records_received" >= 0 and "import_runs"."records_created" >= 0 and
			"import_runs"."records_updated" >= 0 and "import_runs"."records_skipped" >= 0 and
			"import_runs"."records_rejected" >= 0
		)
);
--> statement-breakpoint
CREATE TABLE "import_record_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_run_id" uuid NOT NULL,
	"record_identifier" text NOT NULL,
	"entity_type" "external_entity_type" NOT NULL,
	"severity" "import_issue_severity" NOT NULL,
	"issue_code" "import_issue_code" NOT NULL,
	"safe_message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_record_issues_record_identifier_non_empty_check" CHECK (length(trim("import_record_issues"."record_identifier")) > 0)
);
--> statement-breakpoint
ALTER TABLE "import_record_issues" ADD CONSTRAINT "import_record_issues_import_run_id_import_runs_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "public"."import_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "external_entity_mappings_internal_id_idx" ON "external_entity_mappings" USING btree ("internal_id");--> statement-breakpoint
CREATE INDEX "external_entity_mappings_lookup_idx" ON "external_entity_mappings" USING btree ("source_system","entity_type","internal_id");--> statement-breakpoint
CREATE INDEX "import_runs_source_feed_idx" ON "import_runs" USING btree ("source_system","feed_type");--> statement-breakpoint
CREATE INDEX "import_runs_checksum_idx" ON "import_runs" USING btree ("source_checksum");--> statement-breakpoint
CREATE INDEX "import_runs_status_idx" ON "import_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "import_record_issues_run_id_idx" ON "import_record_issues" USING btree ("import_run_id");--> statement-breakpoint
CREATE INDEX "import_record_issues_severity_idx" ON "import_record_issues" USING btree ("severity");