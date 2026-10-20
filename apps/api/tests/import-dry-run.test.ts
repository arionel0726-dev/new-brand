import { beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db } from '../src/db/client'
import { importRecordIssues } from '../src/db/schema/import-record-issues'
import { importRuns } from '../src/db/schema/import-runs'
import { products } from '../src/db/schema/products'
import { productVariants } from '../src/db/schema/product-variants'
import { runDryRun } from '../src/import/dry-run'
import { resolveOrCreateMapping } from '../src/import/mappings'
import { resetDatabase } from './helpers'

const A10_GROUP = [
	{ ID_nom: 10568, VariativeNomenclature: 'A10.XXX', VariativeName: 'Lipstick A10', ColorVar: 'Red' },
	{ ID_nom: 10516, VariativeNomenclature: 'A10.XXX', VariativeName: 'Lipstick A10', ColorVar: 'Pink' },
	{ ID_nom: 10559, VariativeNomenclature: 'A10.XXX', VariativeName: 'Lipstick A10', ColorVar: 'Coral' }
]

beforeEach(async () => {
	await resetDatabase()
})

describe('runDryRun: zero-write guarantee', () => {
	test('by default (no persistReport) touches the database not at all', async () => {
		await runDryRun({ feedType: 'products', sourceSystem: '1c', payload: A10_GROUP })

		const runs = await db.select().from(importRuns)
		const issues = await db.select().from(importRecordIssues)
		expect(runs).toHaveLength(0)
		expect(issues).toHaveLength(0)
	})

	test('never writes to products or product_variants, with or without persistReport', async () => {
		await runDryRun({ feedType: 'products', sourceSystem: '1c', payload: A10_GROUP, persistReport: true })

		const productRows = await db.select().from(products)
		const variantRows = await db.select().from(productVariants)
		expect(productRows).toHaveLength(0)
		expect(variantRows).toHaveLength(0)
	})

	test('with persistReport, writes exactly one import_runs row and its diagnostics', async () => {
		const result = await runDryRun({
			feedType: 'products',
			sourceSystem: '1c',
			payload: [{ ID_nom: 1 }], // standalone, always blocked for lack of a name
			persistReport: true
		})

		expect(result.summary.importRunId).not.toBeNull()
		const runs = await db.select().from(importRuns)
		expect(runs).toHaveLength(1)
		expect(runs[0].dryRun).toBe(true)

		const issues = await db
			.select()
			.from(importRecordIssues)
			.where(eq(importRecordIssues.importRunId, runs[0].id))
		expect(issues.length).toBeGreaterThan(0)
		expect(issues.some(i => i.issueCode === 'missing_required_field')).toBe(true)
	})
})

describe('runDryRun: summary correctness', () => {
	test('reports the A10.XXX group as one candidate group with 3 variants, publishable', async () => {
		const result = await runDryRun({ feedType: 'products', sourceSystem: '1c', payload: A10_GROUP })
		expect(result.summary.candidateGroups).toBe(1)
		expect(result.summary.candidatesBlocked).toBe(0)
		expect(result.summary.recordsValid).toBe(3)
	})

	test('rejects records with malformed structure and reports them without aborting the whole run', async () => {
		const result = await runDryRun({
			feedType: 'products',
			sourceSystem: '1c',
			payload: [...A10_GROUP, { notAValidRecord: true }]
		})
		expect(result.summary.recordsRejected).toBe(1)
		expect(result.summary.recordsValid).toBe(3)
		expect(result.rejectedSamples).toHaveLength(1)
	})

	test('throws a clear error for a non-array top-level payload (no envelope format assumed)', async () => {
		await expect(
			runDryRun({ feedType: 'products', sourceSystem: '1c', payload: { data: A10_GROUP } })
		).rejects.toThrow(/top-level JSON array/)
	})

	test('legacy-to-V2 reference resolution: an already-mapped nomenclature is reported as existing, not a would-create', async () => {
		const internalId = crypto.randomUUID()
		await db.transaction(tx =>
			resolveOrCreateMapping(tx, {
				sourceSystem: '1c',
				entityType: 'nomenclature',
				externalId: '10568',
				internalId
			})
		)

		const result = await runDryRun({
			feedType: 'products',
			sourceSystem: '1c',
			payload: [{ ID_nom: 10568 }, { ID_nom: 99999 }]
		})

		expect(result.summary.mappingsAlreadyExist).toBe(1)
		expect(result.summary.mappingsWouldCreate).toBe(1)
	})

	test('pricevn and jobvn_seo feeds are also summarized correctly', async () => {
		const pricevn = await runDryRun({
			feedType: 'pricevn',
			sourceSystem: '1c',
			payload: [{ ID_nom: 1, Price: '100' }]
		})
		expect(pricevn.summary.recordsValid).toBe(1)
		expect(pricevn.summary.candidateGroups).toBeUndefined()

		const jobvn = await runDryRun({
			feedType: 'jobvn_seo',
			sourceSystem: '1c',
			payload: [{ ID_nom: 1 }]
		})
		expect(jobvn.summary.recordsValid).toBe(1)
	})

	test('a repeated checksum from a prior persisted run is surfaced in the summary', async () => {
		await runDryRun({ feedType: 'products', sourceSystem: '1c', payload: A10_GROUP, persistReport: true })
		const second = await runDryRun({ feedType: 'products', sourceSystem: '1c', payload: A10_GROUP })
		expect(second.summary.priorRunsWithSameChecksum).toBe(1)
	})
})
