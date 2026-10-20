import { beforeEach, describe, expect, test } from 'bun:test'
import { db } from '../src/db/client'
import { computeChecksum, canonicalize } from '../src/import/checksum'
import { completeImportRun, createImportRun, failImportRun, findRunsByChecksum, getImportRunById } from '../src/import/runs'
import { resetDatabase } from './helpers'

beforeEach(async () => {
	await resetDatabase()
})

describe('checksum', () => {
	test('is deterministic regardless of key order', () => {
		const a = computeChecksum([{ ID_nom: 1, VariativeName: 'x' }])
		const b = computeChecksum([{ VariativeName: 'x', ID_nom: 1 }])
		expect(a).toBe(b)
	})

	test('differs when the payload actually differs', () => {
		const a = computeChecksum([{ ID_nom: 1 }])
		const b = computeChecksum([{ ID_nom: 2 }])
		expect(a).not.toBe(b)
	})

	test('canonicalize sorts nested object keys too', () => {
		const a = canonicalize({ b: 1, a: { d: 1, c: 2 } })
		const b = canonicalize({ a: { c: 2, d: 1 }, b: 1 })
		expect(a).toBe(b)
	})
})

describe('import run state transitions', () => {
	test('a fresh run starts running, then completes with zero rejections', async () => {
		const run = await createImportRun(db, {
			sourceSystem: '1c',
			feedType: 'products',
			dryRun: true,
			sourceChecksum: 'abc'
		})
		expect(run.status).toBe('running')

		const completed = await completeImportRun(db, run.id, {
			recordsReceived: 10,
			recordsCreated: 0,
			recordsUpdated: 0,
			recordsSkipped: 10,
			recordsRejected: 0
		})
		expect(completed.status).toBe('completed')
		expect(completed.completedAt).not.toBeNull()
	})

	test('a run with at least one rejected record completes as partially_failed', async () => {
		const run = await createImportRun(db, {
			sourceSystem: '1c',
			feedType: 'products',
			dryRun: true,
			sourceChecksum: 'def'
		})

		const completed = await completeImportRun(db, run.id, {
			recordsReceived: 5,
			recordsRejected: 2,
			recordsSkipped: 3
		})
		expect(completed.status).toBe('partially_failed')
	})

	test('a run that cannot complete at all is marked failed with a safe error summary', async () => {
		const run = await createImportRun(db, {
			sourceSystem: '1c',
			feedType: 'products',
			dryRun: true,
			sourceChecksum: 'ghi'
		})

		const failed = await failImportRun(db, run.id, 'malformed JSON payload')
		expect(failed.status).toBe('failed')
		expect(failed.lastErrorSummary).toBe('malformed JSON payload')
	})

	test('getImportRunById round-trips', async () => {
		const run = await createImportRun(db, {
			sourceSystem: 'legacy_mysql',
			feedType: 'products',
			dryRun: false,
			sourceChecksum: 'jkl'
		})
		const fetched = await getImportRunById(run.id)
		expect(fetched?.id).toBe(run.id)
		expect(fetched?.dryRun).toBe(false)
	})

	test('a repeated checksum is recognized (surfaced) but does not prevent creating a new run', async () => {
		const checksum = computeChecksum([{ ID_nom: 1 }])
		const first = await createImportRun(db, {
			sourceSystem: '1c',
			feedType: 'products',
			dryRun: true,
			sourceChecksum: checksum
		})
		await completeImportRun(db, first.id, { recordsReceived: 1, recordsSkipped: 1 })

		const priorRuns = await findRunsByChecksum(checksum, 'products')
		expect(priorRuns).toHaveLength(1)

		// A second run against the identical payload is still allowed to run -
		// recognizing a repeat is not the same as refusing to reprocess it
		// (Task 3's documented checksum/reprocessing semantics).
		const second = await createImportRun(db, {
			sourceSystem: '1c',
			feedType: 'products',
			dryRun: true,
			sourceChecksum: checksum
		})
		expect(second.id).not.toBe(first.id)

		const priorRunsAfter = await findRunsByChecksum(checksum, 'products')
		expect(priorRunsAfter).toHaveLength(2)
	})

	test('transaction rollback: a failed completeImportRun inside a larger transaction leaves no partial state', async () => {
		const run = await createImportRun(db, {
			sourceSystem: '1c',
			feedType: 'pricevn',
			dryRun: true,
			sourceChecksum: 'mno'
		})

		await expect(
			db.transaction(async tx => {
				await completeImportRun(tx, run.id, { recordsReceived: 1, recordsSkipped: 1 })
				throw new Error('simulated failure after the counters update')
			})
		).rejects.toThrow('simulated failure')

		// The transaction rolled back - the run is still in its pre-completion state.
		const reloaded = await getImportRunById(run.id)
		expect(reloaded?.status).toBe('running')
		expect(reloaded?.recordsReceived).toBe(0)
	})
})
