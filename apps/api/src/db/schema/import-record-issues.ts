import { sql } from 'drizzle-orm'
import { check, index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { externalEntityTypeEnum } from './external-entity-mappings'
import { importRuns } from './import-runs'

/**
 * Sprint 10A, Task 4 - structured, per-record diagnostics for a single
 * import_runs row. Deliberately never stores the raw source record: only
 * record_identifier (whatever natural key the record itself claims to
 * have - a SKU, an ID_nom, a GUID - as plain text, not the full payload)
 * and a pre-written safe_message per issue_code. A legacy/1C feed can
 * contain customer-adjacent or otherwise sensitive fields (see
 * docs/vizaje-migration-architecture.md) that must never land in a log
 * table a wider set of people can query than can see the original feed.
 */
export const importIssueSeverityEnum = pgEnum('import_issue_severity', ['info', 'warning', 'error'])

export const importIssueCodeEnum = pgEnum('import_issue_code', [
	'validation_failed',
	'unmatched_brand',
	'unmatched_category',
	'duplicate_guid',
	'duplicate_sku',
	'missing_required_field',
	'ambiguous_variant_parent',
	'conflicting_external_mapping',
	'invalid_price',
	'malformed_stock_quantity',
	'unexpected_record_structure',
	'blank_value_would_overwrite_curated_value'
])

export const importRecordIssues = pgTable(
	'import_record_issues',
	{
		id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
		importRunId: uuid('import_run_id')
			.notNull()
			.references(() => importRuns.id, { onDelete: 'cascade' }),
		// Whatever natural key the source record claims (SKU / ID_nom / GUID /
		// row index as a last resort) - never the full record.
		recordIdentifier: text('record_identifier').notNull(),
		entityType: externalEntityTypeEnum('entity_type').notNull(),
		severity: importIssueSeverityEnum('severity').notNull(),
		issueCode: importIssueCodeEnum('issue_code').notNull(),
		// A fixed, pre-written, safe-to-display message per issueCode (see
		// src/import/issues.ts's ISSUE_MESSAGES) - may be parameterized with
		// already-safe values (a SKU, a field name) but never with arbitrary
		// source-record content.
		safeMessage: text('safe_message').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	table => [
		index('import_record_issues_run_id_idx').on(table.importRunId),
		index('import_record_issues_severity_idx').on(table.severity),
		check('import_record_issues_record_identifier_non_empty_check', sql`length(trim(${table.recordIdentifier})) > 0`)
	]
)
