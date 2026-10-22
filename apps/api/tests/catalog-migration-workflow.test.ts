import { describe, expect, test, beforeEach, beforeAll, afterAll } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { env } from '../src/config/env'
import { db, type Database } from '../src/db/client'
import { UnsafeImportTargetError } from '../src/import/catalog-importer'
import {
	runWorkflowReadOnlyPreflight,
	runWorkflowWritePreflight,
	runWorkflowAnalysis,
	runWorkflowWrite,
	resolveWorkflowDatabaseUrl,
	WorkflowWriteRefusedError,
	type WorkflowInputs
} from '../src/import/catalog-migration-workflow'
import { runInRolledBackTransaction } from '../src/import/catalog-slice-rollback'
import { runCatalogImport } from '../src/import/catalog-importer'
import { reconcileFamilies } from '../src/import/reconcile/family-reconciliation'
import { reconcileSqlWith1c } from '../src/import/reconcile/sql-1c-reconciliation'
import { classifyIdNomDuplicates } from '../src/import/reconcile/duplicate-id-nom'
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

/**
 * Sprint 12B.10.1 regression fixture (point 6 of the fix): a REAL, distinct
 * local Postgres database named `beauty_store_dev` - not a string literal
 * stand-in - so the read-only preflight/analysis tests below prove they
 * actually connect to and query a non-`beauty_store_test`-named database
 * successfully, exactly reproducing the bug the user hit running
 * `bun run import:legacy:catalog-workflow -- --brand-id=108` with
 * DATABASE_URL pointed at their own local `beauty_store_dev`.
 */
let devDatabaseUrl: string
let devDb: Database
let devQueryClient: ReturnType<typeof postgres>

beforeAll(async () => {
	const testUrl = new URL(env.DATABASE_URL)
	const devUrl = new URL(env.DATABASE_URL)
	devUrl.pathname = '/beauty_store_dev'
	devDatabaseUrl = devUrl.toString()

	const admin = postgres(testUrl.toString())
	const exists = await admin`select 1 from pg_database where datname = 'beauty_store_dev'`
	if (exists.length === 0) {
		await admin.unsafe('create database beauty_store_dev')
	}
	await admin.end()

	devQueryClient = postgres(devDatabaseUrl)
	const schema = await import('../src/db/schema')
	devDb = drizzle(devQueryClient, { schema }) as Database
	await migrate(devDb, { migrationsFolder: path.join(import.meta.dir, '../drizzle') })
})

afterAll(async () => {
	await devQueryClient.end()
})

describe('runWorkflowReadOnlyPreflight (Requirement 1/3/7): must NOT require beauty_store_test', () => {
	test('reports every check OK against the real isolated test database with a passing migration check', async () => {
		const result = await runWorkflowReadOnlyPreflight(db, env.DATABASE_URL, async () => ({ ok: true, raw: "Everything's fine" }))
		expect(result.ok).toBe(true)
		expect(result.safeTarget.ok).toBe(true)
		expect(result.reachable.ok).toBe(true)
		expect(result.migrationsCurrent.ok).toBe(true)
	})

	test('Sprint 12B.10.1 regression: succeeds against a REAL local database named "beauty_store_dev", not just "beauty_store_test"', async () => {
		const result = await runWorkflowReadOnlyPreflight(devDb, devDatabaseUrl, async () => ({ ok: true, raw: "Everything's fine" }))
		expect(result.ok).toBe(true)
		expect(result.safeTarget.ok).toBe(true)
		expect(result.safeTarget.detail).not.toContain('does not exactly match')
		expect(result.reachable.ok).toBe(true)
	})

	test('still refuses a non-localhost DATABASE_URL (Requirement 7: never silently reads from an arbitrary remote/production host)', async () => {
		let migrationsCheckRan = false
		const result = await runWorkflowReadOnlyPreflight(db, 'postgres://example.com/beauty_store_dev', async () => {
			migrationsCheckRan = true
			return { ok: true, raw: '' }
		})
		expect(result.ok).toBe(false)
		expect(result.safeTarget.ok).toBe(false)
		expect(result.safeTarget.detail).toContain('allowlist')
		expect(result.reachable.detail).toContain('Skipped')
		expect(migrationsCheckRan).toBe(false)
	})

	test('reports a failing migration check without claiming the whole preflight passed', async () => {
		const result = await runWorkflowReadOnlyPreflight(db, env.DATABASE_URL, async () => ({ ok: false, raw: 'drift detected' }))
		expect(result.ok).toBe(false)
		expect(result.migrationsCurrent.ok).toBe(false)
		expect(result.migrationsCurrent.detail).toBe('drift detected')
	})
})

describe('runWorkflowWritePreflight (Requirement 3/5): keeps the ORIGINAL strict beauty_store_test-only behavior', () => {
	test('reports every check OK against the real isolated test database', async () => {
		const result = await runWorkflowWritePreflight(db, env.DATABASE_URL, async () => ({ ok: true, raw: "Everything's fine" }))
		expect(result.ok).toBe(true)
		expect(result.safeTarget.ok).toBe(true)
	})

	test('Sprint 12B.10.1 regression pair: still refuses the same real "beauty_store_dev" database that read-only mode now accepts', async () => {
		let migrationsCheckRan = false
		const result = await runWorkflowWritePreflight(devDb, devDatabaseUrl, async () => {
			migrationsCheckRan = true
			return { ok: true, raw: '' }
		})
		expect(result.ok).toBe(false)
		expect(result.safeTarget.ok).toBe(false)
		expect(result.safeTarget.detail).toContain('does not exactly match')
		expect(migrationsCheckRan).toBe(false)
	})

	test('refuses before even checking reachability/migrations when the host is unsafe', async () => {
		let migrationsCheckRan = false
		const result = await runWorkflowWritePreflight(db, 'postgres://localhost/production', async () => {
			migrationsCheckRan = true
			return { ok: true, raw: '' }
		})
		expect(result.ok).toBe(false)
		expect(result.safeTarget.ok).toBe(false)
		expect(result.reachable.detail).toContain('Skipped')
		expect(migrationsCheckRan).toBe(false)
	})

	test('reports a failing migration check without claiming the whole preflight passed', async () => {
		const result = await runWorkflowWritePreflight(db, env.DATABASE_URL, async () => ({ ok: false, raw: 'drift detected' }))
		expect(result.ok).toBe(false)
		expect(result.migrationsCurrent.ok).toBe(false)
		expect(result.migrationsCurrent.detail).toBe('drift detected')
	})
})

describe('Sprint 12B.10.1 regression: runWorkflowAnalysis itself against the real "beauty_store_dev" database', () => {
	test('the exact reported command path (brand/product analysis against a non-test-named local DB) succeeds without UnsafeImportTargetError', async () => {
		const report = await runWorkflowAnalysis(devDb, cleanStandaloneInputs())
		expect(report.verdict).toBe('READY')
		expect(report.products.totalConsidered).toBe(1)

		// Still provably rolled back - the dev database is untouched afterward.
		const { products } = await import('../src/db/schema/products')
		const rows = await devDb.select().from(products)
		expect(rows.length).toBe(0)
	})
})

describe('Requirement 4: the rollback runWorkflowAnalysis depends on is structural, not conventional', () => {
	test('a REAL write followed by a thrown (non-sentinel) error inside the same rolled-back transaction still leaves zero rows - proven on the actual helper runWorkflowAnalysis composes with three times over', async () => {
		const inputs = cleanStandaloneInputs()
		class InjectedFailureAfterWrite extends Error {}

		const importInput = {
			dump: inputs.dump,
			oneCRecords: inputs.oneCRecords,
			families: reconcileFamilies(inputs.dump, inputs.oneCRecords),
			positions: reconcileSqlWith1c(inputs.dump, inputs.oneCRecords),
			idNomDuplicates: classifyIdNomDuplicates(inputs.rawOneCRecords, 'ID_nom')
		}

		await expect(
			runInRolledBackTransaction(db, async tx => {
				// A real write that genuinely creates a row - exactly like
				// runWorkflowAnalysis's dry-run-preview and
				// post-import-checks-dry-run transactions perform internally.
				const result = await runCatalogImport(tx, importInput, 'write')
				expect(result.summary.productsCreated).toBe(1)
				// Then something genuinely breaks partway through analysis - NOT the
				// IntentionalRollback sentinel `runInRolledBackTransaction` throws
				// internally. The point: rollback must not depend on which error
				// fires, or on `fn` reaching its normal end.
				throw new InjectedFailureAfterWrite('a real error after a real write')
			})
		).rejects.toThrow(InjectedFailureAfterWrite)

		const { products } = await import('../src/db/schema/products')
		const rows = await db.select().from(products)
		expect(rows.length).toBe(0)
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

/**
 * Sprint 12B.11 regression: the exact bug the user hit next, after the
 * Sprint 12B.10.1 fix. Fixing `assertSafeImportTarget`'s scope (read-only
 * vs write) was not enough on its own - the CLI still always read
 * `env.DATABASE_URL` for BOTH preflight validation AND the actual queries,
 * so there was no way to point write mode at `beauty_store_test` without
 * the developer manually overriding DATABASE_URL in their shell every time
 * (exactly the friction Sprint 12B.10 was supposed to remove). These tests
 * cover `resolveWorkflowDatabaseUrl`'s precedence in isolation (pure, no DB)
 * - the CLI wiring itself (which also swaps to a SEPARATE `db`/`queryClient`
 * bound to the resolved URL, never the app-wide singleton bound to
 * `DATABASE_URL`) lives in cli/catalog-migration-workflow.ts and is not
 * re-tested here per the existing project convention that files under
 * import/cli/ run main() unconditionally at module load and are never
 * imported by a test.
 */
describe('resolveWorkflowDatabaseUrl (Sprint 12B.11): env-based test-database targeting, no manual DATABASE_URL juggling', () => {
	test('prefers CATALOG_TEST_DATABASE_URL over DATABASE_URL when both are set, for both read-only and write', () => {
		for (const mode of ['read-only', 'write'] as const) {
			const resolved = resolveWorkflowDatabaseUrl({
				explicitFlag: null,
				catalogTestDatabaseUrl: 'postgres://localhost/beauty_store_test',
				fallbackDatabaseUrl: 'postgres://localhost/beauty_store_dev',
				mode
			})
			expect(resolved.url).toBe('postgres://localhost/beauty_store_test')
			expect(resolved.usedCatalogTestVar).toBe(true)
			expect(resolved.warning).toBeNull()
		}
	})

	test('an explicit --database-url flag always wins, even over CATALOG_TEST_DATABASE_URL', () => {
		const resolved = resolveWorkflowDatabaseUrl({
			explicitFlag: 'postgres://localhost/beauty_store_test_explicit',
			catalogTestDatabaseUrl: 'postgres://localhost/beauty_store_test',
			fallbackDatabaseUrl: 'postgres://localhost/beauty_store_dev',
			mode: 'write'
		})
		expect(resolved.url).toBe('postgres://localhost/beauty_store_test_explicit')
		expect(resolved.usedCatalogTestVar).toBe(false)
	})

	test('falls back to DATABASE_URL with no warning for read-only mode when CATALOG_TEST_DATABASE_URL is unset - this is the explicitly supported safe default', () => {
		const resolved = resolveWorkflowDatabaseUrl({
			explicitFlag: null,
			catalogTestDatabaseUrl: undefined,
			fallbackDatabaseUrl: 'postgres://localhost/beauty_store_dev',
			mode: 'read-only'
		})
		expect(resolved.url).toBe('postgres://localhost/beauty_store_dev')
		expect(resolved.usedCatalogTestVar).toBe(false)
		expect(resolved.warning).toBeNull()
	})

	test('falls back to DATABASE_URL WITH a warning for write mode when CATALOG_TEST_DATABASE_URL is unset - assertSafeImportTarget still refuses it unless it happens to already be beauty_store_test', () => {
		const resolved = resolveWorkflowDatabaseUrl({
			explicitFlag: null,
			catalogTestDatabaseUrl: undefined,
			fallbackDatabaseUrl: 'postgres://localhost/beauty_store_dev',
			mode: 'write'
		})
		expect(resolved.url).toBe('postgres://localhost/beauty_store_dev')
		expect(resolved.warning).not.toBeNull()
		expect(resolved.warning).toContain('CATALOG_TEST_DATABASE_URL')
	})
})

describe('CATALOG_TEST_DATABASE_URL end-to-end (Sprint 12B.11): the real reported scenario', () => {
	test('read-only analysis succeeds when CATALOG_TEST_DATABASE_URL-style targeting points at the real local "beauty_store_dev" database', async () => {
		// Mirrors exactly what the CLI now does: resolveWorkflowDatabaseUrl picks
		// this URL (standing in for CATALOG_TEST_DATABASE_URL being unset and
		// DATABASE_URL happening to point at the dev db, or an explicit
		// --database-url=<dev-url> override) and the read-only preflight/
		// analysis run against it successfully - this is the exact command the
		// user ran (`--brand-id=108` with DATABASE_URL pointed at
		// beauty_store_dev) that originally failed with "does not exactly
		// match beauty_store_test" before the Sprint 12B.10.1/12B.11 fixes.
		const resolved = resolveWorkflowDatabaseUrl({
			explicitFlag: null,
			catalogTestDatabaseUrl: undefined,
			fallbackDatabaseUrl: devDatabaseUrl,
			mode: 'read-only'
		})
		expect(resolved.url).toBe(devDatabaseUrl)

		const preflight = await runWorkflowReadOnlyPreflight(devDb, resolved.url, async () => ({ ok: true, raw: "Everything's fine" }))
		expect(preflight.ok).toBe(true)

		const report = await runWorkflowAnalysis(devDb, cleanStandaloneInputs())
		expect(report.verdict).toBe('READY')
		expect(report.manifestHash).not.toBe('')
	})

	test('write mode still refuses "beauty_store_dev" even when it arrives via the SAME resolution path a correctly-configured CATALOG_TEST_DATABASE_URL would use - the env var points write mode at the right db, it does not loosen the check', async () => {
		// If a developer mis-set CATALOG_TEST_DATABASE_URL to their dev db by
		// mistake, write mode must refuse exactly as if DATABASE_URL itself had
		// been pointed there - resolveWorkflowDatabaseUrl only decides WHICH url
		// is used, assertSafeImportTarget's strictness is completely unchanged.
		const resolved = resolveWorkflowDatabaseUrl({
			explicitFlag: null,
			catalogTestDatabaseUrl: devDatabaseUrl,
			fallbackDatabaseUrl: env.DATABASE_URL,
			mode: 'write'
		})
		expect(resolved.url).toBe(devDatabaseUrl)
		expect(resolved.usedCatalogTestVar).toBe(true)

		const writePreflight = await runWorkflowWritePreflight(devDb, resolved.url, async () => ({ ok: true, raw: "Everything's fine" }))
		expect(writePreflight.ok).toBe(false)
		expect(writePreflight.safeTarget.detail).toContain('does not exactly match')

		const inputs = cleanStandaloneInputs()
		const backupDir = await mkdtemp(path.join(tmpdir(), 'catalog-workflow-envvar-test-'))
		await expect(
			runWorkflowWrite(devDb, { ...inputs, confirmSlice: 'anything', databaseUrl: resolved.url, backupDir })
		).rejects.toBeInstanceOf(UnsafeImportTargetError)
		await rm(backupDir, { recursive: true, force: true })
	})

	test('write mode succeeds when CATALOG_TEST_DATABASE_URL correctly points at beauty_store_test (the intended, correctly-configured case)', async () => {
		const resolved = resolveWorkflowDatabaseUrl({
			explicitFlag: null,
			catalogTestDatabaseUrl: env.DATABASE_URL,
			fallbackDatabaseUrl: devDatabaseUrl,
			mode: 'write'
		})
		expect(resolved.url).toBe(env.DATABASE_URL)
		expect(resolved.usedCatalogTestVar).toBe(true)

		const inputs = cleanStandaloneInputs()
		const analysis = await runWorkflowAnalysis(db, inputs)
		expect(analysis.verdict).toBe('READY')
		const backupDir = await mkdtemp(path.join(tmpdir(), 'catalog-workflow-envvar-test-'))
		const stubBackupSpawn: BackupSpawnFn = async command => {
			const outFile = command[3] as string
			await Bun.write(outFile, `-- PostgreSQL database dump\n-- stub backup for Sprint 12B.11 tests\n${'x'.repeat(100)}\n`)
			return { exitCode: 0, stderr: '' }
		}

		const result = await runWorkflowWrite(db, {
			...inputs,
			confirmSlice: analysis.manifestHash,
			databaseUrl: resolved.url,
			backupDir,
			backupOptions: { spawn: stubBackupSpawn }
		})
		expect(result.firstRun.importResult.summary.productsCreated).toBe(1)
		expect(result.idempotent).toBe(true)
		await rm(backupDir, { recursive: true, force: true })
	})
})
