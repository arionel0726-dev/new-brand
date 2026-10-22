import { describe, expect, test, beforeEach } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { env } from '../src/config/env'
import { db } from '../src/db/client'
import { UnsafeImportTargetError } from '../src/import/catalog-importer'
import {
	runWorkflowPreflight,
	runWorkflowAnalysis,
	runWorkflowWrite,
	WorkflowWriteRefusedError,
	type WorkflowInputs
} from '../src/import/catalog-migration-workflow'
import { BackupFailedError, type SpawnFn as BackupSpawnFn } from '../src/import/catalog-migration-backup'
import type { LegacyCatalogDump, LegacyProduct, LegacyBrand, LegacyCategory } from '../src/import/parsers/mysql-catalog'
import { parseProductsFeed } from '../src/import/parsers/products-feed'
import { resetDatabase } from './helpers'

/** Sprint 12B.10 Requirement 8: synthetic fixtures only, same discipline and GUID==ID_nom matching convention as catalog-slice-db.test.ts. */

function makeLegacyProduct(overrides: Partial<LegacyProduct> & { id: number }): LegacyProduct {
	return {
		guid: null,
		sku: null,
		titleRu: null,
		titleRo: null,
		descRu: null,
		descRo: null,
		textRu: null,
		textRo: null,
		uriRu: null,
		uriRo: null,
		price: null,
		discountPrice: null,
		priceWh: null,
		volume: null,
		onStock: null,
		stock: null,
		isNew: false,
		categoryId: null,
		brandId: null,
		instructionRu: null,
		instructionRo: null,
		componentsRu: null,
		componentsRo: null,
		sex: null,
		seoTitleRu: null,
		seoTitleRo: null,
		seoDescRu: null,
		seoDescRo: null,
		barcode: null,
		warehouseName: null,
		isShown: true,
		createdAt: null,
		updatedAt: null,
		...overrides
	}
}

function makeBrand(overrides: Partial<LegacyBrand> & { id: number }): LegacyBrand {
	return {
		guid: null,
		title: 'TestBrand',
		uri: null,
		textRu: null,
		textRo: null,
		seoTitleRu: null,
		seoTitleRo: null,
		isShown: true,
		sortOrder: 0,
		...overrides
	}
}

function makeCategory(overrides: Partial<LegacyCategory> & { id: number }): LegacyCategory {
	return {
		guid: null,
		parentId: null,
		titleRu: 'TestCategory',
		titleRo: 'TestCategoryRo',
		uriRu: null,
		uriRo: null,
		descRu: null,
		descRo: null,
		seoTitleRu: null,
		seoTitleRo: null,
		isShown: true,
		sortOrder: 0,
		...overrides
	}
}

function makeDump(partial: Partial<LegacyCatalogDump> & { products: LegacyProduct[] }): LegacyCatalogDump {
	return {
		products: partial.products,
		productVariables: [],
		brands: partial.brands ?? [],
		categories: partial.categories ?? [],
		productCategories: partial.productCategories ?? [],
		productImgs: [],
		productVariableImgs: [],
		stores: [],
		storeImgs: [],
		productsMore: []
	}
}

function makeOneCRaw(overrides: Record<string, unknown> & { ID_nom: string | number }): Record<string, unknown> {
	return { Brand: 'TestBrand', Sex: 'Женский', ...overrides }
}

/** A single standalone product with NO legacy brand/category reference at all. */
function cleanStandaloneInputs(): WorkflowInputs {
	const dump = makeDump({ products: [makeLegacyProduct({ id: 701, guid: '70001', titleRu: 'Clean Standalone', uriRu: 'clean-standalone' })] })
	const rawOneCRecords = [makeOneCRaw({ ID_nom: '70001' })]
	return {
		dump,
		rawOneCRecords,
		oneCRecords: parseProductsFeed(rawOneCRecords).validRecords,
		selection: { kind: 'legacyProductIds', legacyProductIds: [701] }
	}
}

/** A standalone product WITH a legacy brand + category reference that has never been bootstrapped in this test database. */
function unbootstrappedBrandCategoryInputs(): WorkflowInputs {
	const dump = makeDump({
		products: [makeLegacyProduct({ id: 702, guid: '70002', titleRu: 'Needs Bootstrap', uriRu: 'needs-bootstrap', brandId: 1, categoryId: 1 })],
		brands: [makeBrand({ id: 1, title: 'Pupa' })],
		categories: [makeCategory({ id: 1, titleRu: 'Lips' })]
	})
	const rawOneCRecords = [makeOneCRaw({ ID_nom: '70002' })]
	return {
		dump,
		rawOneCRecords,
		oneCRecords: parseProductsFeed(rawOneCRecords).validRecords,
		selection: { kind: 'legacyProductIds', legacyProductIds: [702] }
	}
}

beforeEach(async () => {
	await resetDatabase()
})

describe('runWorkflowPreflight (Requirement 3)', () => {
	test('reports every check OK against the real isolated test database with a passing migration check', async () => {
		const result = await runWorkflowPreflight(db, env.DATABASE_URL, async () => ({ ok: true, raw: "Everything's fine" }))
		expect(result.ok).toBe(true)
		expect(result.safeTarget.ok).toBe(true)
		expect(result.reachable.ok).toBe(true)
		expect(result.migrationsCurrent.ok).toBe(true)
	})

	test('refuses before even checking reachability/migrations when the target is unsafe', async () => {
		let migrationsCheckRan = false
		const result = await runWorkflowPreflight(db, 'postgres://localhost/production', async () => {
			migrationsCheckRan = true
			return { ok: true, raw: '' }
		})
		expect(result.ok).toBe(false)
		expect(result.safeTarget.ok).toBe(false)
		expect(result.reachable.detail).toContain('Skipped')
		expect(migrationsCheckRan).toBe(false)
	})

	test('reports a failing migration check without claiming the whole preflight passed', async () => {
		const result = await runWorkflowPreflight(db, env.DATABASE_URL, async () => ({ ok: false, raw: 'drift detected' }))
		expect(result.ok).toBe(false)
		expect(result.migrationsCurrent.ok).toBe(false)
		expect(result.migrationsCurrent.detail).toBe('drift detected')
	})
})

describe('runWorkflowAnalysis (Requirement 1/4): read-only, zero writes', () => {
	test('a clean standalone product with no brand/category reference at all yields READY with no warnings', async () => {
		const report = await runWorkflowAnalysis(db, cleanStandaloneInputs())
		expect(report.verdict).toBe('READY')
		expect(report.blockers).toEqual([])
		expect(report.warnings).toEqual([])
		expect(report.products.totalConsidered).toBe(1)
		expect(report.variants.unitsThatWouldWrite).toBe(1)
		expect(report.manifestHash).not.toBe('')

		// Nothing was actually written - the analysis ran entirely in rolled-back transactions.
		const rowCountCheck = report.postImportChecksDryRun.rowCounts
		expect(rowCountCheck.ok).toBe(true)
	})

	test('a product with an unbootstrapped legacy brand/category yields READY_WITH_WARNINGS, not a failure', async () => {
		const report = await runWorkflowAnalysis(db, unbootstrappedBrandCategoryInputs())
		expect(report.verdict).toBe('READY_WITH_WARNINGS')
		expect(report.blockers).toEqual([])
		expect(report.warnings.length).toBeGreaterThan(0)
		expect(report.brandCategoryReadiness.missingBrandLinks).toBe(1)
		expect(report.brandCategoryReadiness.brandsToBootstrap).toBe(1)
		expect(report.brandCategoryReadiness.categoriesToBootstrap).toBe(1)
	})

	test('an empty explicit selection resolves to NOT_READY with a clear blocker, never a crash', async () => {
		const inputs = cleanStandaloneInputs()
		const report = await runWorkflowAnalysis(db, { ...inputs, selection: { kind: 'legacyProductIds', legacyProductIds: [] } })
		expect(report.verdict).toBe('NOT_READY')
		expect(report.blockers.length).toBeGreaterThan(0)
		expect(report.selection.legacyProductIds).toEqual([])
	})

	test('an explicit selection naming an id that does not exist in the dump resolves to NOT_READY naming the unknown id, never a thrown exception', async () => {
		const inputs = cleanStandaloneInputs()
		const report = await runWorkflowAnalysis(db, { ...inputs, selection: { kind: 'legacyProductIds', legacyProductIds: [999999] } })
		expect(report.verdict).toBe('NOT_READY')
		expect(report.blockers.join(' ')).toContain('999999')
	})

	test('analysis never commits anything - the database is empty before and after', async () => {
		await runWorkflowAnalysis(db, unbootstrappedBrandCategoryInputs())
		const { products } = await import('../src/db/schema/products')
		const rows = await db.select().from(products)
		expect(rows.length).toBe(0)
	})
})

describe('runWorkflowWrite (Requirement 5/6/7): the distinct, safety-gated write path', () => {
	async function makeBackupDir(): Promise<string> {
		return mkdtemp(path.join(tmpdir(), 'catalog-workflow-write-test-'))
	}

	const stubBackupSpawn: BackupSpawnFn = async command => {
		const outFile = command[3] as string
		await Bun.write(outFile, `-- PostgreSQL database dump\n-- stub backup for Sprint 12B.10 tests\n${'x'.repeat(100)}\n`)
		return { exitCode: 0, stderr: '' }
	}

	test('refuses against an unsafe target before anything else runs', async () => {
		const inputs = cleanStandaloneInputs()
		const backupDir = await makeBackupDir()
		await expect(
			runWorkflowWrite(db, { ...inputs, confirmSlice: 'anything', databaseUrl: 'postgres://localhost/production', backupDir })
		).rejects.toBeInstanceOf(UnsafeImportTargetError)
		await rm(backupDir, { recursive: true, force: true })
	})

	test('refuses without a matching --confirm-slice hash', async () => {
		const inputs = cleanStandaloneInputs()
		const backupDir = await makeBackupDir()
		await expect(
			runWorkflowWrite(db, { ...inputs, confirmSlice: 'not-the-real-hash', databaseUrl: env.DATABASE_URL, backupDir, backupOptions: { spawn: stubBackupSpawn } })
		).rejects.toBeInstanceOf(WorkflowWriteRefusedError)
		const { products } = await import('../src/db/schema/products')
		expect((await db.select().from(products)).length).toBe(0)
		await rm(backupDir, { recursive: true, force: true })
	})

	test('refuses to write when pre-write backup creation/validation fails - zero rows written', async () => {
		const inputs = cleanStandaloneInputs()
		const analysis = await runWorkflowAnalysis(db, inputs)
		const backupDir = await makeBackupDir()
		const failingSpawn: BackupSpawnFn = async () => ({ exitCode: 1, stderr: 'disk full' })

		let caught: unknown
		try {
			await runWorkflowWrite(db, {
				...inputs,
				confirmSlice: analysis.manifestHash,
				databaseUrl: env.DATABASE_URL,
				backupDir,
				backupOptions: { spawn: failingSpawn }
			})
		} catch (error) {
			caught = error
		}
		expect(caught).toBeInstanceOf(WorkflowWriteRefusedError)
		expect((caught as WorkflowWriteRefusedError).message).toContain('backup')

		const { products } = await import('../src/db/schema/products')
		expect((await db.select().from(products)).length).toBe(0)
		await rm(backupDir, { recursive: true, force: true })
	})

	test('a valid write + idempotency re-run: first run creates, second run creates nothing new, backup validated', async () => {
		const inputs = cleanStandaloneInputs()
		const analysis = await runWorkflowAnalysis(db, inputs)
		expect(analysis.verdict).toBe('READY')
		const backupDir = await makeBackupDir()

		const result = await runWorkflowWrite(db, {
			...inputs,
			confirmSlice: analysis.manifestHash,
			databaseUrl: env.DATABASE_URL,
			backupDir,
			backupOptions: { spawn: stubBackupSpawn }
		})

		expect(result.backup.sizeBytes).toBeGreaterThan(80)
		expect(result.firstRun.importResult.summary.productsCreated).toBe(1)
		expect(Object.values(result.firstRun.checks).every(c => c.ok)).toBe(true)
		expect(result.secondRun.importResult.summary.productsCreated).toBe(0)
		expect(Object.values(result.secondRun.checks).every(c => c.ok)).toBe(true)
		expect(result.idempotent).toBe(true)

		const { products } = await import('../src/db/schema/products')
		expect((await db.select().from(products)).length).toBe(1)
		await rm(backupDir, { recursive: true, force: true })
	})

	test('a stale confirmSlice hash (computed against a DIFFERENT selection) is rejected, even though it is a real hash', async () => {
		const clean = cleanStandaloneInputs()
		const withBrand = unbootstrappedBrandCategoryInputs()
		const wrongAnalysis = await runWorkflowAnalysis(db, withBrand)
		const backupDir = await makeBackupDir()

		await expect(
			runWorkflowWrite(db, { ...clean, confirmSlice: wrongAnalysis.manifestHash, databaseUrl: env.DATABASE_URL, backupDir, backupOptions: { spawn: stubBackupSpawn } })
		).rejects.toBeInstanceOf(WorkflowWriteRefusedError)
		await rm(backupDir, { recursive: true, force: true })
	})
})
