import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, test } from 'bun:test'
import { db } from '../src/db/client'
import { brands } from '../src/db/schema/brands'
import { categories } from '../src/db/schema/categories'
import { products } from '../src/db/schema/products'
import { productCategories } from '../src/db/schema/product-categories'
import { runCatalogImport, type CatalogImportInput } from '../src/import/catalog-importer'
import { reconcileFamilies } from '../src/import/reconcile/family-reconciliation'
import { reconcileSqlWith1c } from '../src/import/reconcile/sql-1c-reconciliation'
import { classifyIdNomDuplicates } from '../src/import/reconcile/duplicate-id-nom'
import { checkCategoryBrandLinksResolve } from '../src/import/catalog-slice-post-import-checks'
import {
	runScopedReferenceBootstrap,
	extractReferencedBrandCategorySlice
} from '../src/import/scoped-reference-bootstrap'
import type { LegacyCatalogDump, LegacyProduct, LegacyBrand, LegacyCategory } from '../src/import/parsers/mysql-catalog'
import { parseProductsFeed, type ProductsFeedRecord } from '../src/import/parsers/products-feed'
import { resetDatabase } from './helpers'

/**
 * Sprint 12B.7: synthetic fixtures only - standing invariant, never real
 * legacy/1C data. The real Mac run's 5 product roles (standalone=2,
 * confirmed family=40, partial family=984, quarantined family=374, hidden
 * product=661) are mirrored here by legacy id ONLY for traceability -
 * these are simplified standalone-shaped synthetic analogues of those
 * roles (family/partial-family matching itself is already covered by
 * reconcile/*.test.ts and catalog-importer.test.ts; this suite's job is the
 * bootstrap/parity behavior around brand/category resolution, not
 * re-proving family reconciliation).
 */

const BRAND_A = 10 // legacy brand id referenced by products 2, 661, 374
const BRAND_B = 20 // legacy brand id referenced only by an UNRELATED product, never in the scoped slice
const CATEGORY_ROOT = 100 // "Уход" - root
const CATEGORY_CHILD = 101 // "Крем" - child of CATEGORY_ROOT, referenced by products 2, 661, 374
const CATEGORY_UNRELATED = 200 // referenced only by the unrelated product

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

function makeLegacyBrand(overrides: Partial<LegacyBrand> & { id: number }): LegacyBrand {
	return {
		guid: null,
		title: null,
		uri: null,
		textRu: null,
		textRo: null,
		seoTitleRu: null,
		seoTitleRo: null,
		isShown: true,
		sortOrder: null,
		...overrides
	}
}

function makeLegacyCategory(overrides: Partial<LegacyCategory> & { id: number }): LegacyCategory {
	return {
		guid: null,
		parentId: 0,
		titleRu: null,
		titleRo: null,
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

/** Full dump: 4 products sharing (BRAND_A, CATEGORY_CHILD) - roles 2/661/374 - plus one fully unrelated product (BRAND_B/CATEGORY_UNRELATED), proving the scoped bootstrap never pulls in reference data the slice doesn't actually need. */
function makeDump(): LegacyCatalogDump {
	return {
		products: [
			makeLegacyProduct({ id: 2, guid: '2', titleRu: 'Standalone Item', uriRu: 'standalone-item', brandId: BRAND_A, categoryId: CATEGORY_CHILD, isShown: true }),
			makeLegacyProduct({ id: 661, guid: '661', titleRu: 'Hidden Item', uriRu: 'hidden-item', brandId: BRAND_A, categoryId: CATEGORY_CHILD, isShown: false }),
			makeLegacyProduct({ id: 374, guid: '374', titleRu: 'Quarantined Item', uriRu: 'quarantined-item', brandId: BRAND_A, categoryId: CATEGORY_CHILD, isShown: true }),
			makeLegacyProduct({ id: 9999, guid: '9999', titleRu: 'Unrelated Item', uriRu: 'unrelated-item', brandId: BRAND_B, categoryId: CATEGORY_UNRELATED, isShown: true })
		],
		productVariables: [],
		brands: [
			makeLegacyBrand({ id: BRAND_A, title: 'Brand A', uri: 'brand-a' }),
			makeLegacyBrand({ id: BRAND_B, title: 'Brand B', uri: 'brand-b' })
		],
		categories: [
			makeLegacyCategory({ id: CATEGORY_ROOT, parentId: 0, titleRu: 'Уход', titleRo: 'Îngrijire', uriRu: 'uhod' }),
			makeLegacyCategory({ id: CATEGORY_CHILD, parentId: CATEGORY_ROOT, titleRu: 'Крем', titleRo: 'Cremă', uriRu: 'krem' }),
			makeLegacyCategory({ id: CATEGORY_UNRELATED, parentId: 0, titleRu: 'Несвязанное', titleRo: 'Fără legătură', uriRu: 'unrelated' })
		],
		productCategories: [],
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

function parseOneC(raw: Record<string, unknown>[]): ProductsFeedRecord[] {
	return parseProductsFeed(raw).validRecords
}

async function buildImportInput(
	dump: LegacyCatalogDump,
	oneCRaw: Record<string, unknown>[],
	priorQuarantine?: Map<number, ('duplicate_guid' | 'invalid_brand_reference' | 'duplicate_sku')[]>
): Promise<CatalogImportInput> {
	const oneCRecords = parseOneC(oneCRaw)
	return {
		dump,
		oneCRecords,
		families: reconcileFamilies(dump, oneCRecords, priorQuarantine),
		positions: reconcileSqlWith1c(dump, oneCRecords, priorQuarantine),
		idNomDuplicates: classifyIdNomDuplicates(oneCRaw, 'ID_nom')
	}
}

beforeEach(async () => {
	await resetDatabase()
})

describe('Requirement 3: scoped extraction of exactly the brand/category ids a slice references', () => {
	test('extractReferencedBrandCategorySlice returns only BRAND_A and the full CATEGORY_CHILD->CATEGORY_ROOT ancestor chain for products 2/661/374 - never BRAND_B/CATEGORY_UNRELATED', () => {
		const dump = makeDump()
		const slice = extractReferencedBrandCategorySlice(dump, [2, 661, 374])

		expect(slice.brands.map(b => b.id)).toEqual([BRAND_A])
		expect(new Set(slice.categories.map(c => c.id))).toEqual(new Set([CATEGORY_ROOT, CATEGORY_CHILD]))
	})
})

describe('Requirement 2/5/6/10: scoped write bootstrap behavior', () => {
	test('write-mode bootstrap creates exactly the scoped brand/category rows with correct RU/RO names, slugs and parent hierarchy', async () => {
		const dump = makeDump()
		const result = await db.transaction(tx => runScopedReferenceBootstrap(tx, dump, [2, 661, 374], 'write'))

		expect(result.brandResult.summary.created).toBe(1)
		expect(result.categoryResult.summary.created).toBe(2)

		const writtenBrands = await db.select().from(brands)
		expect(writtenBrands).toHaveLength(1)
		// Requirement 6: legacy brands have only one title column - duplicated into both nameRu and nameRo, never left null/invented.
		expect(writtenBrands[0]!.nameRu).toBe('Brand A')
		expect(writtenBrands[0]!.nameRo).toBe('Brand A')
		expect(writtenBrands[0]!.slug).toBe('brand-a')

		const writtenCategories = await db.select().from(categories)
		expect(writtenCategories).toHaveLength(2)
		const root = writtenCategories.find(c => c.slug === 'uhod')!
		const child = writtenCategories.find(c => c.slug === 'krem')!
		// Requirement 6: categories have REAL distinct RU/RO columns - never duplicated.
		expect(root.nameRu).toBe('Уход')
		expect(root.nameRo).toBe('Îngrijire')
		expect(child.nameRu).toBe('Крем')
		expect(child.nameRo).toBe('Cremă')
		// Requirement 5: parent hierarchy - the child's parentId resolves to the root's real internal id.
		expect(root.parentId).toBeNull()
		expect(child.parentId).toBe(root.id)

		// Requirement 2: BRAND_B/CATEGORY_UNRELATED were never touched - the bootstrap is additive AND scoped.
		expect(writtenBrands.some(b => b.slug === 'brand-b')).toBe(false)
		expect(writtenCategories.some(c => c.slug === 'unrelated')).toBe(false)
	})

	test('Requirement 10: running the scoped bootstrap a second time is idempotent - zero new rows, units resolve to updated not created', async () => {
		const dump = makeDump()
		await db.transaction(tx => runScopedReferenceBootstrap(tx, dump, [2, 661, 374], 'write'))

		const second = await db.transaction(tx => runScopedReferenceBootstrap(tx, dump, [2, 661, 374], 'write'))
		expect(second.brandResult.summary.created).toBe(0)
		expect(second.brandResult.summary.updated).toBe(1)
		expect(second.categoryResult.summary.created).toBe(0)
		expect(second.categoryResult.summary.updated).toBe(2)

		expect(await db.select().from(brands)).toHaveLength(1)
		expect(await db.select().from(categories)).toHaveLength(2)
	})

	test('dry-run mode writes zero rows and a second dry-run still reports created (not existing), proving no accidental write happened', async () => {
		const dump = makeDump()
		const first = await db.transaction(tx => runScopedReferenceBootstrap(tx, dump, [2, 661, 374], 'dry-run'))
		expect(first.brandResult.summary.created).toBe(1)
		expect(await db.select().from(brands)).toHaveLength(0)

		const second = await db.transaction(tx => runScopedReferenceBootstrap(tx, dump, [2, 661, 374], 'dry-run'))
		expect(second.brandResult.summary.created).toBe(1)
		expect(second.brandResult.summary.updated).toBe(0)
	})
})

describe('Requirement 4/7/8: repeat import after bootstrap restores brand/category parity without breaking independent unpublish/quarantine reasons', () => {
	test('product 2 (standalone, visible): unpublished-for-missing flags clear and status becomes active once brand/category are bootstrapped', async () => {
		const dump = makeDump()
		const oneCRaw = [makeOneCRaw({ ID_nom: '2' })]

		// First import run - BEFORE bootstrap - reproduces the real Mac gap.
		const beforeInput = await buildImportInput(dump, oneCRaw)
		const before = await db.transaction(tx => runCatalogImport(tx, beforeInput, 'write'))
		const beforeUnit = before.units.find(u => u.key === '2')!
		expect(beforeUnit.unpublishedForMissingBrand).toBe(true)
		expect(beforeUnit.unpublishedForMissingCategory).toBe(true)
		const [beforeRow] = await db.select().from(products).where(eq(products.id, beforeUnit.productId!))
		expect(beforeRow!.status).toBe('draft')
		expect(beforeRow!.brandId).toBeNull()

		// Scoped bootstrap, additive only.
		await db.transaction(tx => runScopedReferenceBootstrap(tx, dump, [2, 661, 374], 'write'))

		// Repeat import of the SAME already-imported slice.
		const afterInput = await buildImportInput(dump, oneCRaw)
		const after = await db.transaction(tx => runCatalogImport(tx, afterInput, 'write'))
		expect(after.summary.productsCreated).toBe(0)
		expect(after.summary.productsUpdated).toBe(1)
		const afterUnit = after.units.find(u => u.key === '2')!
		expect(afterUnit.unpublishedForMissingBrand).toBe(false)
		expect(afterUnit.unpublishedForMissingCategory).toBe(false)

		const [afterRow] = await db.select().from(products).where(eq(products.id, beforeUnit.productId!))
		expect(afterRow!.status).toBe('active')
		expect(afterRow!.brandId).not.toBeNull()

		const links = await db.select().from(productCategories).where(eq(productCategories.productId, afterRow!.id))
		expect(links).toHaveLength(1)
	})

	test('Requirement 7: hidden product 661 stays draft after bootstrap - brand/category resolving must never override legacy isShown=false', async () => {
		const dump = makeDump()
		const oneCRaw = [makeOneCRaw({ ID_nom: '661' })]

		const beforeInput = await buildImportInput(dump, oneCRaw)
		await db.transaction(tx => runCatalogImport(tx, beforeInput, 'write'))

		await db.transaction(tx => runScopedReferenceBootstrap(tx, dump, [2, 661, 374], 'write'))

		const afterInput = await buildImportInput(dump, oneCRaw)
		const after = await db.transaction(tx => runCatalogImport(tx, afterInput, 'write'))
		const afterUnit = after.units.find(u => u.key === '661')!
		// Brand/category DID resolve now...
		expect(afterUnit.unpublishedForMissingBrand).toBe(false)
		expect(afterUnit.unpublishedForMissingCategory).toBe(false)
		// ...but status must still be draft, because isShown=false is independent of brand/category resolution.
		const [row] = await db.select().from(products).where(eq(products.id, afterUnit.productId!))
		expect(row!.status).toBe('draft')
	})

	test('Requirement 8: quarantined product 374 stays skipped and unwritten across bootstrap + repeat import', async () => {
		const dump = makeDump()
		const oneCRaw = [makeOneCRaw({ ID_nom: '374' })]
		const priorQuarantine = new Map<number, ('duplicate_guid' | 'invalid_brand_reference' | 'duplicate_sku')[]>([[374, ['duplicate_guid']]])

		const beforeInput = await buildImportInput(dump, oneCRaw, priorQuarantine)
		const before = await db.transaction(tx => runCatalogImport(tx, beforeInput, 'write'))
		const beforeUnit = before.units.find(u => u.key === '374' || u.key === String(374))
		expect(beforeUnit?.action).toBe('skipped')
		expect(beforeUnit?.skipReason).toBe('quarantine')
		expect(await db.select().from(products)).toHaveLength(0)

		await db.transaction(tx => runScopedReferenceBootstrap(tx, dump, [2, 661, 374], 'write'))

		const afterInput = await buildImportInput(dump, oneCRaw, priorQuarantine)
		const after = await db.transaction(tx => runCatalogImport(tx, afterInput, 'write'))
		const afterUnit = after.units.find(u => u.key === '374' || u.key === String(374))
		expect(afterUnit?.action).toBe('skipped')
		expect(afterUnit?.skipReason).toBe('quarantine')
		// Bootstrapping brand/category reference data must never un-quarantine a product - still zero rows written.
		expect(await db.select().from(products)).toHaveLength(0)
	})
})

describe('Requirement 9: post-import checks distinguish "not yet bootstrapped" from a real dangling FK', () => {
	test('a product written before bootstrap reports missingBrandLinks/missingCategoryLinks, never as an issues failure', async () => {
		const dump = makeDump()
		const oneCRaw = [makeOneCRaw({ ID_nom: '2' })]
		const input = await buildImportInput(dump, oneCRaw)

		await db.transaction(async tx => {
			await runCatalogImport(tx, input, 'write')
			const check = await checkCategoryBrandLinksResolve(tx)
			expect(check.ok).toBe(true)
			expect(check.issues).toHaveLength(0)
			expect(check.missingBrandLinks).toBe(1)
			expect(check.missingCategoryLinks).toBe(1)
		})
	})

	test('after bootstrap + repeat import, missingBrandLinks/missingCategoryLinks drop to 0 and the check still passes', async () => {
		const dump = makeDump()
		const oneCRaw = [makeOneCRaw({ ID_nom: '2' })]
		const input = await buildImportInput(dump, oneCRaw)
		await db.transaction(tx => runCatalogImport(tx, input, 'write'))
		await db.transaction(tx => runScopedReferenceBootstrap(tx, dump, [2, 661, 374], 'write'))
		await db.transaction(tx => runCatalogImport(tx, input, 'write'))

		await db.transaction(async tx => {
			const check = await checkCategoryBrandLinksResolve(tx)
			expect(check.ok).toBe(true)
			expect(check.missingBrandLinks).toBe(0)
			expect(check.missingCategoryLinks).toBe(0)
		})
	})
})
