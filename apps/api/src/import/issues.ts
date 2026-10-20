import { eq } from 'drizzle-orm'
import { db } from '../db/client'
import type { DbOrTx } from '../db/tx'
import {
	importRecordIssues,
	type importIssueCodeEnum,
	type importIssueSeverityEnum
} from '../db/schema/import-record-issues'
import type { EntityType } from './constants'

export type ImportRecordIssueRow = typeof importRecordIssues.$inferSelect
export type ImportIssueCode = (typeof importIssueCodeEnum.enumValues)[number]
export type ImportIssueSeverity = (typeof importIssueSeverityEnum.enumValues)[number]

/**
 * One fixed, pre-written, safe-to-display message per issue code (Task 4) -
 * never the raw source record or an arbitrary interpolated error string.
 * A couple of codes accept a single already-safe parameter (a record's own
 * claimed identifier, a field name) because naming *which* record or field
 * is the point of a diagnostic; nothing here ever interpolates a whole
 * record or an unvalidated free-text value.
 */
const ISSUE_MESSAGES: Record<ImportIssueCode, (detail?: string) => string> = {
	validation_failed: detail => `Record failed schema validation${detail ? `: ${detail}` : ''}`,
	unmatched_brand: detail => `No V2 brand mapping found for legacy brand reference${detail ? ` "${detail}"` : ''}`,
	unmatched_category: detail =>
		`No V2 category mapping found for legacy category reference${detail ? ` "${detail}"` : ''}`,
	duplicate_guid: detail => `Duplicate GUID encountered within the same feed${detail ? `: ${detail}` : ''}`,
	duplicate_sku: detail => `Duplicate SKU encountered within the same feed${detail ? `: ${detail}` : ''}`,
	missing_required_field: detail => `Missing required field${detail ? `: ${detail}` : ''}`,
	ambiguous_variant_parent: detail =>
		`Variant group identifier resolves to more than one candidate parent${detail ? `: ${detail}` : ''}`,
	conflicting_external_mapping: detail => `External identity mapping conflict${detail ? `: ${detail}` : ''}`,
	invalid_price: detail => `Price value could not be parsed safely${detail ? `: ${detail}` : ''}`,
	malformed_stock_quantity: detail => `Stock quantity value is not a valid non-negative integer${detail ? `: ${detail}` : ''}`,
	unexpected_record_structure: detail => `Record does not match any known shape for this feed type${detail ? `: ${detail}` : ''}`,
	blank_value_would_overwrite_curated_value: detail =>
		`Import value is blank and would overwrite an existing curated value - skipped${detail ? ` (${detail})` : ''}`
}

export function safeMessageFor(code: ImportIssueCode, detail?: string): string {
	return ISSUE_MESSAGES[code](detail)
}

export type RecordIssueInput = {
	importRunId: string
	recordIdentifier: string
	entityType: EntityType
	severity: ImportIssueSeverity
	issueCode: ImportIssueCode
	detail?: string
}

export async function recordIssue(dbOrTx: DbOrTx, input: RecordIssueInput): Promise<ImportRecordIssueRow> {
	const [row] = await dbOrTx
		.insert(importRecordIssues)
		.values({
			importRunId: input.importRunId,
			recordIdentifier: input.recordIdentifier,
			entityType: input.entityType,
			severity: input.severity,
			issueCode: input.issueCode,
			safeMessage: safeMessageFor(input.issueCode, input.detail)
		})
		.returning()
	return row
}

export async function recordIssues(dbOrTx: DbOrTx, inputs: RecordIssueInput[]): Promise<ImportRecordIssueRow[]> {
	if (inputs.length === 0) return []
	return dbOrTx
		.insert(importRecordIssues)
		.values(
			inputs.map(input => ({
				importRunId: input.importRunId,
				recordIdentifier: input.recordIdentifier,
				entityType: input.entityType,
				severity: input.severity,
				issueCode: input.issueCode,
				safeMessage: safeMessageFor(input.issueCode, input.detail)
			}))
		)
		.returning()
}

export async function listIssuesForRun(importRunId: string): Promise<ImportRecordIssueRow[]> {
	return db.select().from(importRecordIssues).where(eq(importRecordIssues.importRunId, importRunId))
}
