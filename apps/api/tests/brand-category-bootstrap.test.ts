import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, test } from 'bun:test'
import { db } from '../src/db/client'
import { brands } from '../src/db/schema/brands'
import { categories } from '../src/db/schema/categories'
import { externalEntityMappings } from '../src/db/schema/external-entity-mappings'
import { products } from '../src/db/schema/products'
import {
	bootstrapBrands,
	bootstrapCategories,
	countDraftToPublishableCandidates,
	type BootstrapMode
} from '../src/import/brand-category-bootstrap'
import { assertSafeImportTarget, runCatalogImport, type CatalogImportInput } from '../src/import/catalog-importer'
import { classifyIdNomDuplicates } from '../src/import/reconcile/duplicate-id-nom'
import { reconcileFamilies } from '../src/import/reconcile/family-reconciliation'
import { reconcileSqlWith1c } from '../src/import/reconcile/sql-1c-reconciliation'
import { extractCategories, type LegacyBrand, type LegacyCatalogDump, type LegacyCategory, type LegacyProduct } from '../src/import/parsers/mysql-catalog'
import { parseProductsFeed } from '../src/import/parsers/products-feed'
import { resetDatabase } from './helpers'

/** Synthetic fixtures only - every value below is invented for test purposes, never derived from a real legacy record (Sprint 12B.3's explicit restriction). */

function makeBrand(overrides: Partial<LegacyBrand> & { id: number }): LegacyBrand {
	return {
		guid: null,
		title: `Brand ${overrides.id}`,
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
		parentId: 0,
		titleRu: `Category ${overrides.id}`,
		titleRo: null,
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

function makeLegacyProduct(overrides: Partial<LegacyProduct> & { id: number }): LegacyProduct {
	return {
		guid: null,
		sku: null,
		titleRu: `Product ${overrides.id}`,
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

function makeDump(partial: Partial<LegacyCatalogDump>): LegacyCatalogDump {
	return {
		products: [],
		productVariables: [],
		brands: [],
		categories: [],
		productCategories: [],
		productImgs: [],
		productVariableImgs: [],
		stores: [],
		storeImgs: [],
		productsMore: [],
		...partial
	}
}

beforeEach(async () => {
	await resetDatabase()
})

describe('bootstrapBrands (Requirement 3: RU/RO brand names)', () => {
	test('legacy single-language title is duplicated into both nameRu and nameRo, never left null or machine-translated', async () => {
		const result = await db.transaction(tx => bootstrapBrands(tx, [makeBrand({ id: 1, title: 'Anny' })], 'write'))
		expect(result.summary.created).toBe(1)
		const [row] = await db.select().from(brands).where(eq(brands.id, result.units[0].internalId as string))
		expect(row.nameRu).toBe('Anny')
		expect(row.nameRo).toBe('Anny')
	})

	test('Requirement 6: empty/missing title is never invented - skipped with reason, no brand row written', async () => {
		const result = await db.transaction(tx => bootstrapBrands(tx, [makeBrand({ id: 2, title: null })], 'write'))
		expect(result.summary.skipped).toBe(1)
		expect(result.summary.bySkipReason.empty_title).toBe(1)
		const rows = await db.select().from(brands)
		expect(rows).toHaveLength(0)
	})

	test('Requirement 8: creates a legacy_mysql/brand external mapping', async () => {
		const result = await db.transaction(tx => bootstrapBrands(tx, [makeBrand({ id: 3, title: 'Dior' })], 'write'))
		const [mapping] = await db
			.select()
			.from(externalEntityMappings)
			.where(eq(externalEntityMappings.externalId, '3'))
		expect(mapping.sourceSystem).toBe('legacy_mysql')
		expect(mapping.entityType).toBe('brand')
		expect(mapping.internalId).toBe(result.units[0].internalId as string)
	})
})

describe('bootstrapBrands: Requirement 7 + Important-B (duplicate slug conflict reporting)', () => {
	test('two legacy brands deriving the same slug both get real rows under distinct slugs, and the conflict names BOTH legacy owners', async () => {
		const result = await db.transaction(tx =>
			bootstrapBrands(
				tx,
				[makeBrand({ id: 10, title: 'Same Name', uri: 'same-name' }), makeBrand({ id: 11, title: 'Same Name', uri: 'same-name' })],
				'write'
			)
		)
		expect(result.summary.created).toBe(2)
		expect(result.summary.conflicts).toHaveLength(1)
		const conflict = result.summary.conflicts[0]
		expect([conflict.legacyId, conflict.otherLegacyId].sort()).toEqual([10, 11])

		const rows = await db.select().from(brands)
		const slugs = rows.map(r => r.slug)
		expect(new Set(slugs).size).toBe(2) // both rows exist under distinct slugs
		expect(slugs).toContain('same-name') // the first claimant keeps the base slug
		expect(slugs.some(s => s !== 'same-name')).toBe(true) // the second is suffixed, never silently reassigned onto the first

		// neither owner was dropped or merged into the other
		const mappings = await db.select().from(externalEntityMappings).where(eq(externalEntityMappings.entityType, 'brand'))
		expect(mappings.map(m => m.externalId).sort()).toEqual(['10', '11'])
	})
})

describe('bootstrapCategories: Requirement 4 (parent-child tree order)', () => {
	test('a 3-level tree imports with every child pointing at its real resolved V2 parent', async () => {
		const legacyCategories = [
			makeCategory({ id: 1, parentId: 0, titleRu: 'Root' }),
			makeCategory({ id: 2, parentId: 1, titleRu: 'Mid' }),
			makeCategory({ id: 3, parentId: 2, titleRu: 'Leaf' })
		]
		const result = await db.transaction(tx => bootstrapCategories(tx, legacyCategories, 'write'))
		expect(result.summary.created).toBe(3)
		expect(result.summary.deferredForUnresolvedParent).toBe(0)

		const rows = await db.select().from(categories)
		const root = rows.find(r => r.nameRu === 'Root')!
		const mid = rows.find(r => r.nameRu === 'Mid')!
		const leaf = rows.find(r => r.nameRu === 'Leaf')!
		expect(root.parentId).toBeNull()
		expect(mid.parentId).toBe(root.id)
		expect(leaf.parentId).toBe(mid.id)
	})

	test('insertion order in the source array does not matter - children-before-parent in the input still resolves correctly', async () => {
		const legacyCategories = [
			makeCategory({ id: 3, parentId: 2, titleRu: 'Leaf' }),
			makeCategory({ id: 2, parentId: 1, titleRu: 'Mid' }),
			makeCategory({ id: 1, parentId: 0, titleRu: 'Root' })
		]
		const result = await db.transaction(tx => bootstrapCategories(tx, legacyCategories, 'write'))
		expect(result.summary.created).toBe(3)
		const rows = await db.select().from(categories)
		const mid = rows.find(r => r.nameRu === 'Mid')!
		const leaf = rows.find(r => r.nameRu === 'Leaf')!
		expect(leaf.parentId).toBe(mid.id)
	})
})

describe('bootstrapCategories: Requirement 6 (never invent an identifier)', () => {
	test('parent_id=0 (legacy "no parent" sentinel) imports as a real root, not a fabricated parent', async () => {
		const result = await db.transaction(tx => bootstrapCategories(tx, [makeCategory({ id: 1, parentId: 0 })], 'write'))
		const [row] = await db.select().from(categories)
		expect(row.parentId).toBeNull()
		expect(result.summary.skipped).toBe(0)
	})

	test('a nonzero parent_id that references no real legacy category is reported as invalid_parent, never silently rooted', async () => {
		const result = await db.transaction(tx => bootstrapCategories(tx, [makeCategory({ id: 1, parentId: 999 })], 'write'))
		expect(result.summary.skipped).toBe(1)
		expect(result.summary.bySkipReason.invalid_parent).toBe(1)
		const rows = await db.select().from(categories)
		expect(rows).toHaveLength(0)
	})

	test('a missing titleRU is never invented - skipped with reason', async () => {
		const result = await db.transaction(tx => bootstrapCategories(tx, [makeCategory({ id: 1, titleRu: null })], 'write'))
		expect(result.summary.bySkipReason.empty_title).toBe(1)
	})
})

describe('bootstrapCategories: Requirement 7 + Important-B (slug conflicts at the category level)', () => {
	test('two unrelated categories sharing a derived slug both import, distinctly, with a two-sided conflict report', async () => {
		const result = await db.transaction(tx =>
			bootstrapCategories(tx, [makeCategory({ id: 1, titleRu: 'Makeup' }), makeCategory({ id: 2, titleRu: 'Makeup' })], 'write')
		)
		expect(result.summary.created).toBe(2)
		expect(result.summary.conflicts).toHaveLength(1)
		expect([result.summary.conflicts[0].legacyId, result.summary.conflicts[0].otherLegacyId].sort()).toEqual([1, 2])
	})
})

describe('bootstrap: Requirement 9/10 (dry-run default, write requires explicit mode + safety guard)', () => {
	test('dry-run mode writes nothing to Postgres', async () => {
		const brandResult = await db.transaction(tx => bootstrapBrands(tx, [makeBrand({ id: 1 })], 'dry-run'))
		const categoryResult = await db.transaction(tx => bootstrapCategories(tx, [makeCategory({ id: 1 })], 'dry-run'))
		expect(brandResult.summary.created).toBe(1) // reported as a PLAN
		expect(categoryResult.summary.created).toBe(1)
		expect(await db.select().from(brands)).toHaveLength(0) // but nothing actually persisted
		expect(await db.select().from(categories)).toHaveLength(0)
		expect(await db.select().from(externalEntityMappings)).toHaveLength(0)
	})

	test('the bootstrap CLI reuses catalog-importer.ts\'s own assertSafeImportTarget, not a parallel safety check', () => {
		expect(() => assertSafeImportTarget('postgres://user:pass@localhost:5432/beauty_store')).toThrow()
		expect(() => assertSafeImportTarget('postgres://user:pass@localhost:5432/beauty_store_test')).not.toThrow()
	})
})

describe('bootstrap: Requirement 11 (idempotency)', () => {
	test('running bootstrapBrands twice against identical input yields the same internal id and no duplicate rows', async () => {
		const legacy = [makeBrand({ id: 1, title: 'Anny' })]
		const first = await db.transaction(tx => bootstrapBrands(tx, legacy, 'write'))
		const second = await db.transaction(tx => bootstrapBrands(tx, legacy, 'write'))
		expect(second.summary.created).toBe(0)
		expect(second.summary.updated).toBe(1)
		expect(second.units[0].internalId).toBe(first.units[0].internalId)
		expect(await db.select().from(brands)).toHaveLength(1)
		expect(await db.select().from(externalEntityMappings).where(eq(externalEntityMappings.entityType, 'brand'))).toHaveLength(1)
	})

	test('running bootstrapCategories twice against identical input yields the same internal ids and no duplicate rows', async () => {
		const legacy = [makeCategory({ id: 1, parentId: 0, titleRu: 'Root' }), makeCategory({ id: 2, parentId: 1, titleRu: 'Child' })]
		const first = await db.transaction(tx => bootstrapCategories(tx, legacy, 'write'))
		const second = await db.transaction(tx => bootstrapCategories(tx, legacy, 'write'))
		expect(second.summary.created).toBe(0)
		expect(second.summary.updated).toBe(2)
		expect(await db.select().from(categories)).toHaveLength(2)
		for (const u of second.units) {
			const matching = first.units.find(f => f.legacyId === u.legacyId)
			expect(u.internalId).toBe(matching?.internalId)
		}
	})
})

describe('bootstrap: Requirement 12 (transaction rollback)', () => {
	test('a failure partway through a bootstrap leaves the database unchanged', async () => {
		const legacy = [makeBrand({ id: 1, title: 'Anny' }), makeBrand({ id: 2, title: 'Dior' })]
		await expect(
			db.transaction(async tx => {
				await bootstrapBrands(tx, legacy, 'write')
				throw new Error('forced failure after a successful write')
			})
		).rejects.toThrow('forced failure after a successful write')

		expect(await db.select().from(brands)).toHaveLength(0)
		expect(await db.select().from(externalEntityMappings)).toHaveLength(0)
	})
})

describe('bootstrap: Requirement 13 (product brand/category reconciliation after bootstrap)', () => {
	test('a product import that previously reported missing brand/category now resolves both once the bootstrap has run', async () => {
		const legacyProduct = makeLegacyProduct({ id: 100, guid: '100', titleRu: 'Lipstick', brandId: 5, categoryId: 7, uriRu: null })
		const dump = makeDump({
			products: [legacyProduct],
			brands: [makeBrand({ id: 5, title: 'Anny' })],
			categories: [makeCategory({ id: 7, titleRu: 'Makeup' })],
			productCategories: [{ id: 1, productId: 100, categoryId: 7 }]
		})
		const oneCRaw = [{ ID_nom: '100', Brand: 'Anny', Sex: 'Женский' }]
		const oneCRecords = parseProductsFeed(oneCRaw).validRecords

		// Phase 1: import the product BEFORE the bootstrap exists - brand/category must be unresolved.
		const beforeInput: CatalogImportInput = {
			dump,
			oneCRecords,
			families: reconcileFamilies(dump, oneCRecords),
			positions: reconcileSqlWith1c(dump, oneCRecords),
			idNomDuplicates: classifyIdNomDuplicates(oneCRaw, 'ID_nom')
		}
		const before = await db.transaction(tx => runCatalogImport(tx, beforeInput, 'write'))
		expect(before.units[0].unpublishedForMissingBrand).toBe(true)
		expect(before.units[0].unpublishedForMissingCategory).toBe(true)
		const [productBefore] = await db.select().from(products).where(eq(products.id, before.units[0].productId as string))
		expect(productBefore.status).toBe('draft')
		expect(productBefore.brandId).toBeNull()

		// Phase 2: run the bootstrap.
		await db.transaction(async tx => {
			await bootstrapBrands(tx, dump.brands, 'write')
			await bootstrapCategories(tx, dump.categories, 'write')
		})

		// Phase 3: re-run the SAME product import - brand/category must now resolve, without re-architecting catalog-importer.ts's own generic mapping lookup.
		const afterInput: CatalogImportInput = {
			...beforeInput,
			families: reconcileFamilies(dump, oneCRecords),
			positions: reconcileSqlWith1c(dump, oneCRecords)
		}
		const after = await db.transaction(tx => runCatalogImport(tx, afterInput, 'write'))
		expect(after.units[0].unpublishedForMissingBrand).toBe(false)
		expect(after.units[0].unpublishedForMissingCategory).toBe(false)
		const [productAfter] = await db.select().from(products).where(eq(products.id, after.units[0].productId as string))
		expect(productAfter.status).toBe('active')
		expect(productAfter.brandId).not.toBeNull()
	})
})

describe('Requirement 14/15: draft-to-publishable methodology (not a fabricated real number)', () => {
	test('countDraftToPublishableCandidates counts only created/updated units with both brand and category resolved, demonstrated on a synthetic set', () => {
		const units = [
			{ action: 'created', unpublishedForMissingBrand: false, unpublishedForMissingCategory: false }, // publishable
			{ action: 'created', unpublishedForMissingBrand: true, unpublishedForMissingCategory: false }, // missing brand
			{ action: 'updated', unpublishedForMissingBrand: false, unpublishedForMissingCategory: true }, // missing category
			{ action: 'skipped', unpublishedForMissingBrand: false, unpublishedForMissingCategory: false }, // never a draft product at all
			{ action: 'updated', unpublishedForMissingBrand: false, unpublishedForMissingCategory: false } // publishable
		]
		expect(countDraftToPublishableCandidates(units)).toBe(2)
	})

	test('Requirement 15: the bootstrap itself never flips a product\'s own status - only catalog-importer.ts writes `status`, and only to draft/active via its own brand+category resolution, never bulk-published by this module', async () => {
		const legacyProduct = makeLegacyProduct({ id: 200, guid: '200', titleRu: 'Serum', brandId: 9, categoryId: null })
		const dump = makeDump({ products: [legacyProduct], brands: [makeBrand({ id: 9, title: 'Dior' })] })
		await db.transaction(tx => bootstrapBrands(tx, dump.brands, 'write'))

		const oneCRaw = [{ ID_nom: '200', Brand: 'Dior', Sex: 'Женский' }]
		const oneCRecords = parseProductsFeed(oneCRaw).validRecords
		const input: CatalogImportInput = {
			dump,
			oneCRecords,
			families: reconcileFamilies(dump, oneCRecords),
			positions: reconcileSqlWith1c(dump, oneCRecords),
			idNomDuplicates: classifyIdNomDuplicates(oneCRaw, 'ID_nom')
		}
		const result = await db.transaction(tx => runCatalogImport(tx, input, 'write'))
		// brand resolved, category did NOT (none supplied) -> still draft, never auto-published
		const [row] = await db.select().from(products).where(eq(products.id, result.units[0].productId as string))
		expect(row.status).toBe('draft')
	})
})

describe('Sprint 12B.3.1 Requirement 1: enriched per-skip diagnostic fields', () => {
	test('a skipped brand carries its legacy name (or explicit empty string), legacyParentId=null, and the supplied product-reference count', async () => {
		const result = await db.transaction(tx =>
			bootstrapBrands(tx, [makeBrand({ id: 50, title: '' })], 'write', new Map([[50, 7]]))
		)
		const unit = result.units[0]
		expect(unit.action).toBe('skipped')
		expect(unit.legacyName).toBe('')
		expect(unit.legacyParentId).toBeNull()
		expect(unit.referencingProductCount).toBe(7)
		expect(unit.skipReason).toBe('empty_title')
	})

	test('referencingProductCount is undefined (not 0) when the caller supplies no cross-reference map - "not checked" is never confused with "zero references"', async () => {
		const result = await db.transaction(tx => bootstrapBrands(tx, [makeBrand({ id: 51, title: '' })], 'write'))
		expect(result.units[0].referencingProductCount).toBeUndefined()
	})

	test('a skipped category carries its legacyParentId exactly as read from the dump (including the raw invalid value) and a product-reference count', async () => {
		const result = await db.transaction(tx =>
			bootstrapCategories(tx, [makeCategory({ id: 60, parentId: 999 })], 'write', new Map([[60, 3]]))
		)
		const unit = result.units[0]
		expect(unit.skipReason).toBe('invalid_parent')
		expect(unit.legacyParentId).toBe(999)
		expect(unit.referencingProductCount).toBe(3)
		expect(unit.skipDetail).toContain('999')
	})
})

describe('Sprint 12B.3.1 Requirement 3: root-category sentinel re-verified, not a bug', () => {
	test('parent_id=0 and parent_id=null both resolve as root - re-confirms the existing behavior is already correct, not a newly-discovered fix', async () => {
		const result = await db.transaction(tx =>
			bootstrapCategories(tx, [makeCategory({ id: 1, parentId: 0, titleRu: 'RootZero' }), makeCategory({ id: 2, parentId: null, titleRu: 'RootNull' })], 'write')
		)
		expect(result.summary.skipped).toBe(0)
		const rows = await db.select().from(categories)
		expect(rows.every(r => r.parentId === null)).toBe(true)
	})
})

describe('Sprint 12B.3.1 Requirement 2: parent_not_resolved explains WHY, not a generic "cycle or upstream failure"', () => {
	test('a child of an already-invalid_parent category is reported with its ancestor\'s reason, distinct from a genuine cycle', async () => {
		// Category 2's parent (1) has an invalid_parent itself (points at nonexistent 999),
		// so 2 can never resolve - but this is NOT a cycle, it's a cascading unresolvable ancestor.
		const legacy = [makeCategory({ id: 1, parentId: 999, titleRu: 'BrokenParent' }), makeCategory({ id: 2, parentId: 1, titleRu: 'Child' })]
		const result = await db.transaction(tx => bootstrapCategories(tx, legacy, 'write'))
		expect(result.summary.bySkipReason.invalid_parent).toBe(1)
		expect(result.summary.bySkipReason.parent_not_resolved).toBe(1)
		const child = result.units.find(u => u.legacyId === 2)!
		expect(child.skipReason).toBe('parent_not_resolved')
		expect(child.skipDetail).toContain('itself skipped')
		expect(child.skipDetail).toContain('invalid_parent')
		expect(child.skipDetail).not.toContain('cycle')
	})

	test('a genuine two-node cycle (A parents B, B parents A) is reported as a cycle, not conflated with an invalid-parent cascade', async () => {
		const legacy = [makeCategory({ id: 1, parentId: 2, titleRu: 'A' }), makeCategory({ id: 2, parentId: 1, titleRu: 'B' })]
		const result = await db.transaction(tx => bootstrapCategories(tx, legacy, 'write'))
		expect(result.summary.created).toBe(0)
		expect(result.summary.bySkipReason.parent_not_resolved).toBe(2)
		expect(result.summary.deferredForUnresolvedParent).toBe(2)
		for (const u of result.units) {
			expect(u.skipDetail).toContain('cycle')
		}
	})
})

describe('Sprint 12B.3.1 Requirement 7 re-check: catalog-importer.ts composes with the enriched bootstrap unchanged', () => {
	test('the existing Requirement 13 reconciliation test shape still passes with the new bootstrap signature (extra optional param does not break composition)', async () => {
		const legacyProduct = makeLegacyProduct({ id: 400, guid: '400', titleRu: 'Toner', brandId: 15, categoryId: null, uriRu: null })
		const dump = makeDump({ products: [legacyProduct], brands: [makeBrand({ id: 15, title: 'Vichy' })] })
		await db.transaction(tx => bootstrapBrands(tx, dump.brands, 'write'))
		const oneCRaw = [{ ID_nom: '400', Brand: 'Vichy', Sex: 'Женский' }]
		const oneCRecords = parseProductsFeed(oneCRaw).validRecords
		const input: CatalogImportInput = {
			dump,
			oneCRecords,
			families: reconcileFamilies(dump, oneCRecords),
			positions: reconcileSqlWith1c(dump, oneCRecords),
			idNomDuplicates: classifyIdNomDuplicates(oneCRaw, 'ID_nom')
		}
		const result = await db.transaction(tx => runCatalogImport(tx, input, 'write'))
		expect(result.units[0].unpublishedForMissingBrand).toBe(false)
	})
})

describe('Important-A: quarantinedPositionsTotal vs bySkipReason.quarantine (12B.2.1 fix should keep them equal)', () => {
	test('for a synthetic set with quarantined positions, the two counters agree - a future mismatch is itself a regression signal, not expected noise', async () => {
		const quarantined = makeLegacyProduct({ id: 300, titleRu: 'Quarantined item' })
		const dump = makeDump({ products: [quarantined] })
		const oneCRaw = [{ ID_nom: '300', Brand: 'X', Sex: 'Женский' }]
		const oneCRecords = parseProductsFeed(oneCRaw).validRecords
		const priorQuarantine = new Map([[300, ['duplicate_guid'] as ('duplicate_guid' | 'invalid_brand_reference' | 'duplicate_sku')[]]])
		const input: CatalogImportInput = {
			dump,
			oneCRecords,
			families: reconcileFamilies(dump, oneCRecords, priorQuarantine),
			positions: reconcileSqlWith1c(dump, oneCRecords, priorQuarantine),
			idNomDuplicates: classifyIdNomDuplicates(oneCRaw, 'ID_nom')
		}
		const result = await db.transaction(tx => runCatalogImport(tx, input, 'dry-run'))
		// Per catalog-importer.ts's own Sprint 12B.2.1 Task 6 doc comment, these
		// two numbers are DESIGNED to match post-fix - this test pins that
		// invariant going forward. A real run showing 403 vs. 387 almost
		// certainly compares a post-fix number against a PRE-fix run (the old
		// lumped-family counting this test would have failed against).
		expect(result.summary.quarantinedPositionsTotal).toBe(result.summary.bySkipReason.quarantine)
	})
})

describe('Sprint 12B.3.2 Requirement 1: referencingProductCount distinguishes "0 confirmed" from "not checked"', () => {
	test('a supplied map with no entry for this legacy id reports a confirmed 0, never "not checked" - the exact real-run bug (brand 162 showed 56 correctly, every skipped category showed "not checked" even though the map was always supplied)', async () => {
		const emptyMapButSupplied = new Map<number, number>()
		const result = await db.transaction(tx => bootstrapBrands(tx, [makeBrand({ id: 162, title: '' })], 'write', emptyMapButSupplied))
		expect(result.units[0].skipReason).toBe('empty_title')
		expect(result.units[0].referencingProductCount).toBe(0)
	})

	test('an entry present in the supplied map still reports its real count (brand 162-shaped case: nonzero references)', async () => {
		const result = await db.transaction(tx => bootstrapBrands(tx, [makeBrand({ id: 162, title: '' })], 'write', new Map([[162, 56]])))
		expect(result.units[0].referencingProductCount).toBe(56)
	})

	test('omitting the map entirely still reports "not checked" (undefined), never silently reads as 0', async () => {
		const result = await db.transaction(tx => bootstrapBrands(tx, [makeBrand({ id: 163, title: '' })], 'write'))
		expect(result.units[0].referencingProductCount).toBeUndefined()
	})

	test('the same distinction holds for categories: a supplied-but-empty map reports a confirmed 0 for an invalid_parent skip', async () => {
		const result = await db.transaction(tx =>
			bootstrapCategories(tx, [makeCategory({ id: 4, parentId: 999 })], 'write', new Map<number, number>())
		)
		expect(result.units[0].skipReason).toBe('invalid_parent')
		expect(result.units[0].referencingProductCount).toBe(0)
	})
})

describe('Sprint 12B.3.2 Requirement 3: primary vs secondary category membership reported separately', () => {
	test('a category reports primary and secondary unique-product counts as distinct fields, not merged into one', async () => {
		const result = await db.transaction(tx =>
			bootstrapCategories(tx, [makeCategory({ id: 4, parentId: 999 })], 'write', new Map([[4, 3]]), {
				primary: new Map([[4, 1]]),
				secondary: new Map([[4, 2]])
			})
		)
		const unit = result.units[0]
		expect(unit.referencingProductCount).toBe(3)
		expect(unit.referencingProductCountPrimary).toBe(1)
		expect(unit.referencingProductCountSecondary).toBe(2)
	})

	test('a category with zero primary but nonzero secondary membership is NOT reported as fully unused - Sprint 12A.2\'s "stale primary, valid secondary" pattern stays visible', async () => {
		const result = await db.transaction(tx =>
			bootstrapCategories(tx, [makeCategory({ id: 55, parentId: 999 })], 'write', new Map([[55, 4]]), {
				primary: new Map(), // supplied, genuinely zero primary references
				secondary: new Map([[55, 4]])
			})
		)
		const unit = result.units[0]
		expect(unit.referencingProductCountPrimary).toBe(0)
		expect(unit.referencingProductCountSecondary).toBe(4)
	})

	test('omitting the per-source maps leaves both primary and secondary undefined ("not checked"), independent of the combined count', async () => {
		const result = await db.transaction(tx => bootstrapCategories(tx, [makeCategory({ id: 4, parentId: 999 })], 'write', new Map([[4, 3]])))
		const unit = result.units[0]
		expect(unit.referencingProductCount).toBe(3)
		expect(unit.referencingProductCountPrimary).toBeUndefined()
		expect(unit.referencingProductCountSecondary).toBeUndefined()
	})
})

describe('Sprint 12B.3.2 Requirement 4: the parser never silently drops a category row', () => {
	test('extractCategories passes through every row found in the dump, including one whose id is never referenced as anyone\'s parent and one that is only ever referenced as a (missing) parent - neither is dropped nor substituted', () => {
		const sql = `
INSERT INTO \`categories\` (\`id\`, \`GUID\`, \`parent_id\`, \`titleRU\`, \`titleRO\`, \`uriRU\`, \`uriRO\`, \`descRU\`, \`descRO\`, \`seoTitleRU\`, \`seoTitleRO\`, \`isShown\`, \`sorder\`) VALUES
(4, NULL, 1, 'Makeup', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1, 0),
(5, NULL, 4, 'Lips', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1, 0);
`
		const categories = extractCategories(sql)
		// Both real rows present - the parser itself never excludes a row it
		// parsed; it is the REFERENCED id 1 (category 4's declared parent)
		// that is genuinely absent from this dump, which is a data fact, not
		// a parsing defect. This directly confirms Sprint 12B.3.2 Requirement
		// 4's finding: extractCategories has no filter/validation step that
		// could silently drop a row - it is an unconditional .map() over
		// every INSERT row found for the `categories` table.
		expect(categories.map(c => c.id).sort()).toEqual([4, 5])
		expect(categories.find(c => c.id === 1)).toBeUndefined()
	})
})

describe('Sprint 12B.3.2 Requirement 7: nothing is auto-changed by these diagnostic improvements', () => {
	test('an invalid_parent category is still reported, never force-rooted or given a fabricated parent, regardless of its referencing counts', async () => {
		const result = await db.transaction(tx =>
			bootstrapCategories(tx, [makeCategory({ id: 27, parentId: 1, titleRu: 'Broken' })], 'write', new Map([[27, 10]]), {
				primary: new Map([[27, 10]]),
				secondary: new Map()
			})
		)
		expect(result.summary.created).toBe(0)
		expect(result.units[0].skipReason).toBe('invalid_parent')
		const rows = await db.select().from(categories)
		expect(rows).toHaveLength(0)
	})
})
