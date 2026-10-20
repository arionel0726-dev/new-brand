import { sql } from 'drizzle-orm'
import { boolean, check, index, integer, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { externalSourceSystemEnum } from './external-entity-mappings'

/**
 * Sprint 10A, Task 3 - one row per attempted import (dry-run or, once
 * Task 9 is unblocked, a real one), independent of whether it actually
 * wrote anything. A dry-run still gets a row here (status eventually
 * 'completed', every records_* counter reflecting what *would* have
 * happened) - that is what makes "did we already see this exact file"
 * answerable without re-parsing it.
 */
export const importFeedTypeEnum = pgEnum('import_feed_type', ['products', 'pricevn', 'jobvn_seo'])

export const importRunStatusEnum = pgEnum('import_run_status', [
	'pending',
	'running',
	'completed',
	// Some records imported/validated fine, others were rejected - the run
	// itself still finished (as opposed to 'failed', where the run could
	// not complete at all, e.g. malformed JSON for the whole file).
	'partially_failed',
	'failed'
])

export const importRuns = pgTable(
	'import_runs',
	{
		id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
		sourceSystem: externalSourceSystemEnum('source_system').notNull(),
		feedType: importFeedTypeEnum('feed_type').notNull(),
		status: importRunStatusEnum('status').notNull().default('pending'),
		// Whether this run actually wrote anything (Task 8/9) - a dry-run row
		// is never mistaken for a real import in a later audit.
		dryRun: boolean('dry_run').notNull().default(true),
		startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
		completedAt: timestamp('completed_at', { withTimezone: true }),
		// sha256 of the canonicalized input payload (src/import/checksum.ts) -
		// identical bytes always produce the same checksum, so a repeated
		// file is recognized. See that module's own doc comment for why a
		// matching checksum is *never* treated as "safe to auto-skip" on its
		// own - the import policy/parser/normalization logic version matters
		// just as much as the input bytes.
		sourceChecksum: text('source_checksum').notNull(),
		// Whatever version/timestamp marker the feed itself supplies, if any
		// (Task 3) - purely informational, never used as the uniqueness key.
		sourceVersion: text('source_version'),
		recordsReceived: integer('records_received').notNull().default(0),
		recordsCreated: integer('records_created').notNull().default(0),
		recordsUpdated: integer('records_updated').notNull().default(0),
		recordsSkipped: integer('records_skipped').notNull().default(0),
		recordsRejected: integer('records_rejected').notNull().default(0),
		// A short, safe-to-display summary of the last fatal error (if the run
		// failed outright) - never a raw stack trace or raw record content;
		// per-record detail lives in import_record_issues (Task 4) instead.
		lastErrorSummary: text('last_error_summary'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	table => [
		index('import_runs_source_feed_idx').on(table.sourceSystem, table.feedType),
		index('import_runs_checksum_idx').on(table.sourceChecksum),
		index('import_runs_status_idx').on(table.status),
		check('import_runs_records_non_negative_check', sql`
			${table.recordsReceived} >= 0 and ${table.recordsCreated} >= 0 and
			${table.recordsUpdated} >= 0 and ${table.recordsSkipped} >= 0 and
			${table.recordsRejected} >= 0
		`),
	]
)
