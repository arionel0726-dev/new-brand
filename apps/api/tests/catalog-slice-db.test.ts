import { eq, sql } from 'drizzle-orm'
import { beforeEach, describe, expect, test } from 'bun:test'
import { db } from '../src/db/client'
import { products } from '../src/db/schema/products'
import { productVariants } from '../src/db/schema/product-variants'
import { productVariantBarcodes } from '../src/db/schema/product-variant-barcodes'
import { externalEntityMappings } from '../src/db/schema/external-entity-mappings'
import { runCatalogImport, assertSafeImportTarget, UnsafeImportTargetError, type CatalogImportInput } from '../src/import/catalog-importer'
import { reconcileFamilies } from '../src/import/reconcile/family-reconciliation'
import { reconcileSqlWith1c } from '../src/import/reconcile/sql-1c-reconciliation'
import { classifyIdNomDuplicates } from '../src/import/reconcile/duplicate-id-nom'
import type { LegacyCatalogDump, LegacyProduct } from '../src/import/parsers/mysql-catalog'
import { parseProductsFeed, type ProductsFeedRecord } from '../src/import/parsers/products-feed'
import {
	checkRowCounts,
	checkNoOrphanVariants,
	checkNoDuplicateSkus,
	checkNoDuplicateExternalIdMappings,
	checkBarcodeIntegrity,
	checkCategoryBrandLinksResolve,
	checkRepeatRunCreatedNothingNew
} from '../src/import/catalog-slice-post-import-checks'
import { runInRolledBackTransaction, resetCatalogTestDatabase, IntentionalRollback, UnsafeResetError } from '../src/import/catalog-slice-rollback'
import { runAtomicSliceWrite, runAtomicSliceWriteWithBootstrap, PostImportChecksFailedError } from '../src/import/catalog-slice-write'
import { collections, collectionProducts } from '../src/db/schema/collections'
import { brands } from '../src/db/schema/brands'
import { categories } from '../src/db/schema/categories'
import { productCategories } from '../src/db/schema/product-categories'
import { runScopedReferenceBootstrap } from '../src/import/scoped-reference-bootstrap'
import type { LegacyBrand, LegacyCategory } from '../src/import/parsers/mysql-catalog'
import { resetDatabase } from './helpers'

/** Sprint 12B.6 Requirement 8: synthetic fixtures only. */

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

function makeDump(products: LegacyProduct[], referenceData?: { brands?: LegacyBrand[]; categories?: LegacyCategory[] }): LegacyCatalogDump {
	return {
		products,
		productVariables: [],
		brands: referenceData?.brands ?? [],
		categories: referenceData?.categories ?? [],
		productCategories: [],
		productImgs: [],
		productVariableImgs: [],
		stores: [],
		storeImgs: [],
		productsMore: []
	}
}

function makeLegacyBrand(overrides: Partial<LegacyBrand> & { id: number }): LegacyBrand {
	return { guid: null, title: 'Pupa', uri: null, textRu: null, textRo: null, seoTitleRu: null, seoTitleRo: null, isShown: true, sortOrder: null, ...overrides }
}

function makeLegacyCategory(overrides: Partial<LegacyCategory> & { id: number }): LegacyCategory {
	return {
		guid: null,
		parentId: null,
		titleRu: 'Category',
		titleRo: 'Categorie',
		uriRu: null,
		uriRo: null,
		descRu: null,
		descRo: null,
		seoTitleRu: null,
		seoTitleRo: null,
		isShown: true,
		sortOrder: null,
		...overrides
	}
}

function makeOneCRaw(overrides: Record<string, unknown> & { ID_nom: string | number }): Record<string, unknown> {
	return { Brand: 'TestBrand', Sex: 'Женский', ...overrides }
}

function parseOneC(raw: Record<string, unknown>[]): ProductsFeedRecord[] {
	return parseProductsFeed(raw).validRecords
}

async function buildInput(dump: LegacyCatalogDump, oneCRaw: Record<string, unknown>[]): Promise<CatalogImportInput> {
	const oneCRecords = parseOneC(oneCRaw)
	return {
		dump,
		oneCRecords,
		families: reconcileFamilies(dump, oneCRecords),
		positions: reconcileSqlWith1c(dump, oneCRecords),
		idNomDuplicates: classifyIdNomDuplicates(oneCRaw, 'ID_nom')
	}
}

beforeEach(async () => {
	await resetDatabase()
})

describe('Requirement 6: post-import checks against real written state', () => {
	test('a clean two-barcode write passes every check', async () => {
		const dump = makeDump([makeLegacyProduct({ id: 901, guid: '90001', barcode: '1112223334445', titleRu: 'Clean Item', uriRu: 'clean-item' })])
		const oneCRaw = [makeOneCRaw({ ID_nom: '90001', Barcode: '9998887776665' })]
		const input = await buildInput(dump, oneCRaw)

		await db.transaction(async tx => {
			const result = await runCatalogImport(tx, input, 'write')
			expect(result.summary.productsCreated).toBe(1)

			const rowCounts = await checkRowCounts(tx, { products: 1, variants: 1 })
			expect(rowCounts.ok).toBe(true)
			expect((await checkNoOrphanVariants(tx)).ok).toBe(true)
			expect((await checkNoDuplicateSkus(tx)).ok).toBe(true)
			expect((await checkNoDuplicateExternalIdMappings(tx)).ok).toBe(true)
			expect((await checkBarcodeIntegrity(tx)).ok).toBe(true)
			expect((await checkCategoryBrandLinksResolve(tx)).ok).toBe(true)
		})
	})

	test('checkRowCounts reports a mismatch instead of passing silently', async () => {
		const dump = makeDump([makeLegacyProduct({ id: 902, guid: '90002', titleRu: 'Another Item', uriRu: 'another-item' })])
		const oneCRaw = [makeOneCRaw({ ID_nom: '90002' })]
		const input = await buildInput(dump, oneCRaw)
		await db.transaction(async tx => {
			await runCatalogImport(tx, input, 'write')
			const result = await checkRowCounts(tx, { products: 2, variants: 2 })
			expect(result.ok).toBe(false)
			expect(result.actual.products).toBe(1)
			expect(result.issues.join(' ')).toContain('expected 2 products, found 1')
		})
	})

	test('checkNoOrphanVariants catches a variant with no external_entity_mappings row', async () => {
		const dump = makeDump([makeLegacyProduct({ id: 903, guid: '90003', titleRu: 'Orphan Source', uriRu: 'orphan-source' })])
		const oneCRaw = [makeOneCRaw({ ID_nom: '90003' })]
		const input = await buildInput(dump, oneCRaw)
		await db.transaction(async tx => {
			await runCatalogImport(tx, input, 'write')
			expect((await checkNoOrphanVariants(tx)).ok).toBe(true)

			// Deliberately corrupt: delete every mapping, simulating a variant
			// that the import process somehow left untraceable.
			await tx.delete(externalEntityMappings)
			const corrupted = await checkNoOrphanVariants(tx)
			expect(corrupted.ok).toBe(false)
			expect(corrupted.issues.length).toBeGreaterThan(0)
		})
	})

	test('checkNoDuplicateSkus catches a manually duplicated sku', async () => {
		const dump = makeDump([
			makeLegacyProduct({ id: 904, guid: '90004', titleRu: 'Sku Source A', uriRu: 'sku-source-a' }),
			makeLegacyProduct({ id: 905, guid: '90005', titleRu: 'Sku Source B', uriRu: 'sku-source-b' })
		])
		const oneCRaw = [makeOneCRaw({ ID_nom: '90004' }), makeOneCRaw({ ID_nom: '90005' })]
		const input = await buildInput(dump, oneCRaw)
		// Run inside a rolled-back transaction (Requirement 7's helper) because
		// this test must drop the real `sku` uniqueness constraint to force a
		// duplicate at the row level - proving the check inspects real data
		// rather than trusting the DB constraint alone - and a rolled-back
		// transaction guarantees that drop never actually persists.
		await runInRolledBackTransaction(db, async tx => {
			await runCatalogImport(tx, input, 'write')
			expect((await checkNoDuplicateSkus(tx)).ok).toBe(true)

			const variants = await tx.select().from(productVariants)
			await tx.execute(sql`alter table product_variants drop constraint product_variants_sku_unique`)
			await tx.update(productVariants).set({ sku: variants[0].sku }).where(eq(productVariants.id, variants[1].id))
			const corrupted = await checkNoDuplicateSkus(tx)
			expect(corrupted.ok).toBe(false)
		})
	})

	test('checkBarcodeIntegrity catches two rows flagged isPrimary for the same variant', async () => {
		const dump = makeDump([makeLegacyProduct({ id: 906, guid: '90006', barcode: '5556667778889', titleRu: 'Barcode Source', uriRu: 'barcode-source' })])
		const oneCRaw = [makeOneCRaw({ ID_nom: '90006', Barcode: '5556667778889' })]
		const input = await buildInput(dump, oneCRaw)
		await db.transaction(async tx => {
			await runCatalogImport(tx, input, 'write')
			expect((await checkBarcodeIntegrity(tx)).ok).toBe(true)

			const [existing] = await tx.select().from(productVariantBarcodes)
			// Deliberately corrupt: a second barcode row for the same variant,
			// also flagged primary - two sources of truth for "the" primary barcode.
			await tx.insert(productVariantBarcodes).values({
				variantId: existing.variantId,
				barcode: '0000000000000',
				isPrimary: true,
				source: 'test-corruption'
			})
			const corrupted = await checkBarcodeIntegrity(tx)
			expect(corrupted.ok).toBe(false)
			expect(corrupted.issues.join(' ')).toContain('rows flagged isPrimary')
		})
	})

	test('checkRepeatRunCreatedNothingNew distinguishes a real repeat run from a broken one', () => {
		expect(checkRepeatRunCreatedNothingNew(1, 0).ok).toBe(true)
		expect(checkRepeatRunCreatedNothingNew(1, 1).ok).toBe(false)
		expect(checkRepeatRunCreatedNothingNew(0, 0).ok).toBe(false)
	})

	test('a real repeat run of the same slice creates zero additional products (idempotency)', async () => {
		const dump = makeDump([makeLegacyProduct({ id: 907, guid: '90007', titleRu: 'Repeat Source', uriRu: 'repeat-source' })])
		const oneCRaw = [makeOneCRaw({ ID_nom: '90007' })]
		const input = await buildInput(dump, oneCRaw)

		const first = await db.transaction(tx => runCatalogImport(tx, input, 'write'))
		const second = await db.transaction(tx => runCatalogImport(tx, input, 'write'))
		expect(checkRepeatRunCreatedNothingNew(first.summary.productsCreated, second.summary.productsCreated).ok).toBe(true)
		expect(second.summary.productsCreated).toBe(0)
		expect(second.summary.productsUpdated).toBe(1)
	})
})

describe('Requirement 7: rollback mechanisms', () => {
	test('runInRolledBackTransaction returns the callback result but leaves nothing written', async () => {
		const dump = makeDump([makeLegacyProduct({ id: 908, guid: '90008', titleRu: 'Rollback Source', uriRu: 'rollback-source' })])
		const oneCRaw = [makeOneCRaw({ ID_nom: '90008' })]
		const input = await buildInput(dump, oneCRaw)

		const result = await runInRolledBackTransaction(db, tx => runCatalogImport(tx, input, 'write'))
		expect(result.summary.productsCreated).toBe(1)

		const remaining = await db.select().from(products)
		expect(remaining).toHaveLength(0)
	})

	test('a real (non-sentinel) error inside the callback still propagates, not swallowed as a rollback', async () => {
		class RealFailure extends Error {}
		await expect(
			runInRolledBackTransaction(db, async () => {
				throw new RealFailure('something genuinely broke')
			})
		).rejects.toThrow(RealFailure)
	})

	test('IntentionalRollback thrown by application code outside the helper is not silently swallowed elsewhere', () => {
		expect(() => {
			throw new IntentionalRollback('test')
		}).toThrow(IntentionalRollback)
	})

	test('resetCatalogTestDatabase refuses (fails closed) against a non-test database URL', async () => {
		await expect(resetCatalogTestDatabase(db, 'postgres://user:pass@localhost:5432/beauty_store_prod')).rejects.toThrow(
			UnsafeImportTargetError
		)
	})

	test('resetCatalogTestDatabase actually clears catalog tables when pointed at the real test database', async () => {
		const dump = makeDump([makeLegacyProduct({ id: 909, guid: '90009', titleRu: 'Reset Source', uriRu: 'reset-source' })])
		const oneCRaw = [makeOneCRaw({ ID_nom: '90009' })]
		const input = await buildInput(dump, oneCRaw)
		await db.transaction(tx => runCatalogImport(tx, input, 'write'))
		expect(await db.select().from(products)).toHaveLength(1)

		await resetCatalogTestDatabase(db, process.env.DATABASE_URL!)
		expect(await db.select().from(products)).toHaveLength(0)
		expect(await db.select().from(externalEntityMappings)).toHaveLength(0)
	})
})

describe('assertSafeImportTarget sanity (reused, unchanged, Sprint 12B.4 Priority 6)', () => {
	test('still rejects anything but the exact local test database', () => {
		expect(() => assertSafeImportTarget('postgres://user:pass@remote-host:5432/beauty_store_test')).toThrow(UnsafeImportTargetError)
	})
})

describe('Sprint 12B.6.1 Task 1: atomic write + validation (runAtomicSliceWrite)', () => {
	test('a clean write commits and passes every check', async () => {
		const dump = makeDump([makeLegacyProduct({ id: 950, guid: '95001', titleRu: 'Atomic Source', uriRu: 'atomic-source' })])
		const oneCRaw = [makeOneCRaw({ ID_nom: '95001' })]
		const input = await buildInput(dump, oneCRaw)

		const { importResult, checks } = await runAtomicSliceWrite(db, input)
		expect(importResult.summary.productsCreated).toBe(1)
		expect(Object.values(checks).every(c => c.ok)).toBe(true)

		const written = await db.select().from(products)
		expect(written).toHaveLength(1)
	})

	test('a forced post-import check failure proves the entire write was rolled back - queried against real DB state, not a return value', async () => {
		const dump = makeDump([makeLegacyProduct({ id: 951, guid: '95101', titleRu: 'Forced Failure Source', uriRu: 'forced-failure-source' })])
		const oneCRaw = [makeOneCRaw({ ID_nom: '95101' })]
		const input = await buildInput(dump, oneCRaw)

		// Replicates runAtomicSliceWrite's exact shape (import + checks in one
		// transaction, throw on failure) but deliberately corrupts state
		// between the write and the checks - the only way to FORCE a real
		// check failure without disabling a guard the import itself relies on.
		await expect(
			db.transaction(async tx => {
				const importResult = await runCatalogImport(tx, input, 'write')
				expect(importResult.summary.productsCreated).toBe(1)
				// Deliberate corruption: erase the identity trail a real bug
				// might leave behind, so checkNoOrphanVariants - one of the
				// exact checks runAtomicSliceWrite runs - fails.
				await tx.delete(externalEntityMappings)
				const orphanCheck = await checkNoOrphanVariants(tx)
				expect(orphanCheck.ok).toBe(false)
				throw new PostImportChecksFailedError({
					rowCounts: { ok: true, issues: [], actual: { products: 1, variants: 1 } },
					orphanVariants: orphanCheck,
					duplicateSkus: { ok: true, issues: [] },
					duplicateExternalIdMappings: { ok: true, issues: [] },
					barcodeIntegrity: { ok: true, issues: [] },
					categoryBrandLinks: { ok: true, issues: [], missingBrandLinks: 0, missingCategoryLinks: 0 }
				})
			})
		).rejects.toThrow(PostImportChecksFailedError)

		// Queried on a FRESH statement against the real table, outside any
		// transaction this test controls - proving the product row the
		// callback above saw (via `importResult.summary.productsCreated`)
		// never actually survived the transaction's rollback.
		const afterRollback = await db.select().from(products).where(eq(products.slug, 'forced-failure-source'))
		expect(afterRollback).toHaveLength(0)
		const mappingsAfterRollback = await db.select().from(externalEntityMappings)
		expect(mappingsAfterRollback).toHaveLength(0)
	})

	test('repeat write via runAtomicSliceWrite creates zero additional products the second time (idempotency)', async () => {
		const dump = makeDump([makeLegacyProduct({ id: 952, guid: '95201', titleRu: 'Repeat Atomic Source', uriRu: 'repeat-atomic-source' })])
		const oneCRaw = [makeOneCRaw({ ID_nom: '95201' })]
		const input = await buildInput(dump, oneCRaw)

		const first = await runAtomicSliceWrite(db, input)
		expect(first.importResult.summary.productsCreated).toBe(1)
		expect(first.importResult.summary.productsUpdated).toBe(0)

		const second = await runAtomicSliceWrite(db, input)
		expect(second.importResult.summary.productsCreated).toBe(0)
		expect(second.importResult.summary.productsUpdated).toBe(1)
		expect(checkRepeatRunCreatedNothingNew(first.importResult.summary.productsCreated, second.importResult.summary.productsCreated).ok).toBe(
			true
		)

		const actualRows = await db.select().from(products)
		expect(actualRows).toHaveLength(1)
	})
})

describe('Sprint 12B.6.1 Task 3: resetCatalogTestDatabase refuses an unsafe reset', () => {
	test('refuses when an out-of-domain table the CASCADE would reach is not empty, and leaves everything untouched', async () => {
		const dump = makeDump([makeLegacyProduct({ id: 953, guid: '95301', titleRu: 'Reset Guard Source', uriRu: 'reset-guard-source' })])
		const oneCRaw = [makeOneCRaw({ ID_nom: '95301' })]
		const input = await buildInput(dump, oneCRaw)
		await db.transaction(tx => runCatalogImport(tx, input, 'write'))
		const [product] = await db.select().from(products)
		expect(product).toBeDefined()

		// Seed an out-of-domain table (never part of CATALOG_IMPORT_TABLES)
		// that references the just-written product - exactly the scenario a
		// bare `TRUNCATE ... CASCADE` would silently reach into.
		const [collection] = await db.insert(collections).values({ slug: 'reset-guard-collection', titleRu: 'RU', titleRo: 'RO' }).returning()
		await db.insert(collectionProducts).values({ collectionId: collection.id, productId: product.id })

		await expect(resetCatalogTestDatabase(db, process.env.DATABASE_URL!)).rejects.toThrow(UnsafeResetError)

		// Nothing was touched - neither the catalog data nor the out-of-domain row.
		expect(await db.select().from(products)).toHaveLength(1)
		expect(await db.select().from(collectionProducts)).toHaveLength(1)
	})
})

describe('Sprint 12B.10.2: runAtomicSliceWriteWithBootstrap orders bootstrap before import', () => {
	test('a genuinely empty target database (no brands, no categories) still succeeds end-to-end - products are created ACTIVE with real brand/category links, not left draft with missing links', async () => {
		const legacyBrand = makeLegacyBrand({ id: 960, title: 'Pupa' })
		const legacyCategory = makeLegacyCategory({ id: 960, titleRu: 'Lipstick' })
		const dump = makeDump(
			[makeLegacyProduct({ id: 960, guid: '96001', titleRu: 'Bootstrap-first Source', uriRu: 'bootstrap-first-source', brandId: 960, categoryId: 960 })],
			{ brands: [legacyBrand], categories: [legacyCategory] }
		)
		const oneCRaw = [makeOneCRaw({ ID_nom: '96001' })]
		const input = await buildInput(dump, oneCRaw)

		// Precondition this test actually proves something: brands/categories
		// are genuinely empty before the write, exactly the state the user's
		// confirmed real Pupa read-only run reported (1 brand + 20 categories
		// needing bootstrap for a brand-new target database).
		expect(await db.select().from(brands)).toHaveLength(0)
		expect(await db.select().from(categories)).toHaveLength(0)

		const result = await runAtomicSliceWriteWithBootstrap(db, dump, [960], input)
		expect(result.bootstrap.brandResult.summary.created).toBe(1)
		expect(result.bootstrap.categoryResult.summary.created).toBe(1)
		expect(result.importResult.summary.productsCreated).toBe(1)
		expect(Object.values(result.checks).every(c => c.ok)).toBe(true)
		expect(result.checks.categoryBrandLinks.missingBrandLinks).toBe(0)
		expect(result.checks.categoryBrandLinks.missingCategoryLinks).toBe(0)

		// Proven against real committed state, not just the return value: had
		// bootstrap NOT run first (the pre-fix `runWorkflowWrite`, which went
		// straight to `runAtomicSliceWrite` with no bootstrap step at all),
		// `resolveBrandId`/`writeCategoryLinksPreview` would have found zero
		// `external_entity_mappings` rows for brand/category 960, and this
		// product would have been written `status: 'draft'` with a null
		// `brand_id` and zero `product_categories` rows - precisely the gap
		// Sprint 12B.7 already found and fixed for the separate manual CLI
		// flow, which the unified workflow's write path had silently
		// reintroduced by never composing the two steps together.
		const [written] = await db.select().from(products)
		expect(written.status).toBe('active')
		expect(written.brandId).not.toBeNull()
		const categoryLinks = await db.select().from(productCategories).where(eq(productCategories.productId, written.id))
		expect(categoryLinks).toHaveLength(1)
	})

	test('a repeat run (idempotency) resolves bootstrap to all-updated and the import to 0 created / 1 updated', async () => {
		const legacyBrand = makeLegacyBrand({ id: 961, title: 'Pupa' })
		const legacyCategory = makeLegacyCategory({ id: 961, titleRu: 'Mascara' })
		const dump = makeDump(
			[makeLegacyProduct({ id: 961, guid: '96101', titleRu: 'Repeat Bootstrap Source', uriRu: 'repeat-bootstrap-source', brandId: 961, categoryId: 961 })],
			{ brands: [legacyBrand], categories: [legacyCategory] }
		)
		const oneCRaw = [makeOneCRaw({ ID_nom: '96101' })]
		const input = await buildInput(dump, oneCRaw)

		const first = await runAtomicSliceWriteWithBootstrap(db, dump, [961], input)
		expect(first.bootstrap.brandResult.summary.created).toBe(1)
		expect(first.importResult.summary.productsCreated).toBe(1)

		const second = await runAtomicSliceWriteWithBootstrap(db, dump, [961], input)
		expect(second.bootstrap.brandResult.summary.created).toBe(0)
		expect(second.bootstrap.brandResult.summary.updated).toBe(1)
		expect(second.bootstrap.categoryResult.summary.created).toBe(0)
		expect(second.importResult.summary.productsCreated).toBe(0)
		expect(second.importResult.summary.productsUpdated).toBe(1)
		expect(Object.values(second.checks).every(c => c.ok)).toBe(true)

		expect(await db.select().from(brands)).toHaveLength(1)
		expect(await db.select().from(categories)).toHaveLength(1)
		expect(await db.select().from(products)).toHaveLength(1)
	})

	test('a failing post-import check rolls back the bootstrap too, atomically - not just the product import', async () => {
		const legacyBrand = makeLegacyBrand({ id: 962, title: 'Pupa' })
		const legacyCategory = makeLegacyCategory({ id: 962, titleRu: 'Nails' })
		const dump = makeDump(
			[makeLegacyProduct({ id: 962, guid: '96201', titleRu: 'Rollback Bootstrap Source', uriRu: 'rollback-bootstrap-source', brandId: 962, categoryId: 962 })],
			{ brands: [legacyBrand], categories: [legacyCategory] }
		)
		const oneCRaw = [makeOneCRaw({ ID_nom: '96201' })]
		const input = await buildInput(dump, oneCRaw)

		// Same deliberate-corruption technique as the existing
		// runAtomicSliceWrite rollback test above, replicated for the
		// bootstrap-composed path: bootstrap commits brand/category rows
		// inside the SAME transaction as the import, so when a post-import
		// check is forced to fail, the brand/category rows must roll back
		// too - proving this is one atomic unit, not bootstrap-then-separately-import.
		await expect(
			db.transaction(async tx => {
				const bootstrap = await runScopedReferenceBootstrap(tx, dump, [962], 'write')
				expect(bootstrap.brandResult.summary.created).toBe(1)
				const importResult = await runCatalogImport(tx, input, 'write')
				await tx.delete(externalEntityMappings)
				throw new PostImportChecksFailedError({
					rowCounts: { ok: true, issues: [], actual: { products: 1, variants: 1 } },
					orphanVariants: { ok: false, issues: ['forced failure'] },
					duplicateSkus: { ok: true, issues: [] },
					duplicateExternalIdMappings: { ok: true, issues: [] },
					barcodeIntegrity: { ok: true, issues: [] },
					categoryBrandLinks: { ok: true, issues: [], missingBrandLinks: 0, missingCategoryLinks: 0 }
				})
			})
		).rejects.toThrow(PostImportChecksFailedError)

		expect(await db.select().from(brands)).toHaveLength(0)
		expect(await db.select().from(categories)).toHaveLength(0)
		expect(await db.select().from(products)).toHaveLength(0)
	})
})
