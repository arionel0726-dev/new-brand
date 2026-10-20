import { and, eq } from 'drizzle-orm'
import { db } from '../db/client'
import type { DbOrTx } from '../db/tx'
import { importRuns } from '../db/schema/import-runs'
import type { FeedType, SourceSystem } from './constants'

export type ImportRunRow = typeof importRuns.$inferSelect

export type RecordCounters = {
	recordsReceived: number
	recordsCreated: number
	recordsUpdated: number
	recordsSkipped: number
	recordsRejected: number
}

export type CreateImportRunInput = {
	sourceSystem: SourceSystem
	feedType: FeedType
	dryRun: boolean
	sourceChecksum: string
	sourceVersion?: string | null
}

export async function createImportRun(dbOrTx: DbOrTx, input: CreateImportRunInput): Promise<ImportRunRow> {
	const [row] = await dbOrTx
		.insert(importRuns)
		.values({
			sourceSystem: input.sourceSystem,
			feedType: input.feedType,
			dryRun: input.dryRun,
			sourceChecksum: input.sourceChecksum,
			sourceVersion: input.sourceVersion ?? null,
			status: 'running'
		})
		.returning()
	return row
}

export type FinishImportRunInput = Partial<RecordCounters> & { lastErrorSummary?: string | null }

/** 'completed' if nothing was rejected, 'partially_failed' if the run finished but at least one record was rejected. */
export async function completeImportRun(
	dbOrTx: DbOrTx,
	runId: string,
	counters: FinishImportRunInput
): Promise<ImportRunRow> {
	const status = (counters.recordsRejected ?? 0) > 0 ? 'partially_failed' : 'completed'
	const [row] = await dbOrTx
		.update(importRuns)
		.set({
			status,
			completedAt: new Date(),
			updatedAt: new Date(),
			...counters
		})
		.where(eq(importRuns.id, runId))
		.returning()
	return row
}

/** The run could not complete at all (e.g. the whole file failed to parse as JSON) - distinct from 'partially_failed', where the run finished but rejected some records. */
export async function failImportRun(dbOrTx: DbOrTx, runId: string, errorSummary: string): Promise<ImportRunRow> {
	const [row] = await dbOrTx
		.update(importRuns)
		.set({ status: 'failed', completedAt: new Date(), updatedAt: new Date(), lastErrorSummary: errorSummary })
		.where(eq(importRuns.id, runId))
		.returning()
	return row
}

export async function getImportRunById(runId: string): Promise<ImportRunRow | null> {
	const [row] = await db.select().from(importRuns).where(eq(importRuns.id, runId)).limit(1)
	return row ?? null
}

/** Every prior run that saw this exact checksum for this feed type - surfaced to the operator (Task 3), never used to silently skip. */
export async function findRunsByChecksum(sourceChecksum: string, feedType: FeedType): Promise<ImportRunRow[]> {
	return db
		.select()
		.from(importRuns)
		.where(and(eq(importRuns.sourceChecksum, sourceChecksum), eq(importRuns.feedType, feedType)))
}
