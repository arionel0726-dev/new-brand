import { beforeEach, describe, expect, test } from 'bun:test'
import {
	buildCatalogSlice,
	resolveLegacyProductIds,
	UnknownLegacyProductIdError,
	type SliceCriteria
} from '../src/import/catalog-slice'
import { autoSelectDiverseSlice, type SliceScenarioKind } from '../src/import/catalog-slice-scenarios'
import { buildSlicePreview, computeSliceManifestHash, assertSliceConfirmed, SliceConfirmationError } from '../src/import/catalog-slice-preview'
import type { LegacyCatalogDump, LegacyProduct, LegacyProductVariable, LegacyCategory, LegacyBrand } from '../src/import/parsers/mysql-catalog'
import { parseProductsFeed, type ProductsFeedRecord } from '../src/import/parsers/products-feed'
import { reconcileSqlWith1c } from '../src/import/reconcile/sql-1c-reconciliation'
import { reconcileLegacyVariantFamilies } from '../src/import/reconcile/legacy-variant-family-reconciliation'
import { reconcileFamilies } from '../src/import/reconcile/family-reconciliation'
import { classifyIdNomDuplicates } from '../src/import/reconcile/duplicate-id-nom'
import { runCatalogImport, type CatalogImportInput } from '../src/import/catalog-importer'
import { db } from '../src/db/client'
import { resetDatabase } from './helpers'

/**
 * Sprint 12B.6 Requirement 8: synthetic fixtures only - every value below is
 * invented for test purposes, never derived from a real legacy record.
 */

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

function makeVariable(overrides: Partial<LegacyProductVariable> & { id: number; productId: number }): LegacyProductVariable {
	return {
		sku: null,
		titleRu: null,
		titleRo: null,
		colorRu: null,
		colorRo: null,
		colorHex: null,
		volumeVar: null,
		dose: null,
		price: null,
		discountPrice: null,
		qty: null,
		qtyWh: null,
		priceWh: null,
		barcode: null,
		warehouseName: null,
		isShown: true,
		sortOrder: 0,
		...overrides
	}
}

function makeCategory(overrides: Partial<LegacyCategory> & { id: number }): LegacyCategory {
	return {
		guid: null,
		parentId: null,
		titleRu: null,
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

function makeBrand(overrides: Partial<LegacyBrand> & { id: number }): LegacyBrand {
	return {
		guid: null,
		title: null,
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

function emptyDump(partial: Partial<LegacyCatalogDump>): LegacyCatalogDump {
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

function makeOneCRaw(overrides: Record<string, unknown> & { ID_nom: string | number }): Record<string, unknown> {
	return { Brand: 'TestBrand', Sex: 'Женский', ...overrides }
}

function parseOneC(raw: Record<string, unknown>[]): ProductsFeedRecord[] {
	return parseProductsFeed(raw).validRecords
}

describe('buildCatalogSlice (Requirement 1: FK closure)', () => {
	test('pulls in a product, its variables, images, category links, and the brand/category rows it references', () => {
		const dump = emptyDump({
			products: [
				makeLegacyProduct({ id: 1, brandId: 10, categoryId: 100 }),
				makeLegacyProduct({ id: 2, brandId: 20, categoryId: 200 })
			],
			brands: [makeBrand({ id: 10, title: 'Brand A' }), makeBrand({ id: 20, title: 'Brand B' })],
			categories: [
				makeCategory({ id: 100, titleRu: 'Category A', parentId: 50 }),
				makeCategory({ id: 50, titleRu: 'Parent of A', parentId: null }),
				makeCategory({ id: 200, titleRu: 'Category B' })
			],
			productVariables: [makeVariable({ id: 11, productId: 1, sku: '110' }), makeVariable({ id: 21, productId: 2, sku: '210' })],
			productImgs: [{ id: 1001, productId: 1, img: 'a.jpg', sortOrder: 0, isShown: true }],
			productVariableImgs: [{ id: 2001, productId: 1, variableId: 11, img: 'av.jpg', sortOrder: 0, isShown: true }],
			productCategories: [{ id: 1, productId: 1, categoryId: 100 }]
		})

		const slice = buildCatalogSlice(dump, [1])

		expect(slice.products.map(p => p.id)).toEqual([1])
		expect(slice.productVariables.map(v => v.id)).toEqual([11])
		expect(slice.productImgs.map(i => i.id)).toEqual([1001])
		expect(slice.productVariableImgs.map(i => i.id)).toEqual([2001])
		expect(slice.productCategories.map(pc => pc.productId)).toEqual([1])
		expect(slice.brands.map(b => b.id)).toEqual([10])
		// Parent category chain included, not just the directly-linked category
		expect(new Set(slice.categories.map(c => c.id))).toEqual(new Set([100, 50]))
	})

	test('never includes a row belonging to an unselected product (no dangling or leaked data)', () => {
		const dump = emptyDump({
			products: [makeLegacyProduct({ id: 1 }), makeLegacyProduct({ id: 2 })],
			productVariables: [makeVariable({ id: 11, productId: 1 }), makeVariable({ id: 21, productId: 2 })]
		})
		const slice = buildCatalogSlice(dump, [1])
		expect(slice.products.map(p => p.id)).toEqual([1])
		expect(slice.productVariables.map(v => v.id)).toEqual([11])
	})

	test('throws (fails closed) rather than silently shrinking the slice when a requested id does not exist', () => {
		const dump = emptyDump({ products: [makeLegacyProduct({ id: 1 })] })
		expect(() => buildCatalogSlice(dump, [1, 999])).toThrow(UnknownLegacyProductIdError)
	})

	test('Requirement 3: every id in the slice is copied verbatim, never fabricated or renumbered', () => {
		const dump = emptyDump({
			products: [makeLegacyProduct({ id: 777, guid: 'REAL-GUID-777', sku: 'REAL-SKU-777', barcode: 'REAL-BARCODE-777' })],
			productVariables: [makeVariable({ id: 8888, productId: 777, sku: 'REAL-VARIANT-SKU', barcode: 'REAL-VARIANT-BARCODE' })]
		})
		const slice = buildCatalogSlice(dump, [777])
		expect(slice.products[0]).toEqual(dump.products[0])
		expect(slice.productVariables[0]).toEqual(dump.productVariables[0])
	})
})

describe('resolveLegacyProductIds (Requirement 1: selection modes)', () => {
	const dump = emptyDump({
		products: [
			makeLegacyProduct({ id: 1, brandId: 10, categoryId: 100 }),
			makeLegacyProduct({ id: 2, brandId: 10, categoryId: 200 }),
			makeLegacyProduct({ id: 3, brandId: 20, categoryId: 100 })
		],
		productCategories: [{ id: 1, productId: 2, categoryId: 100 }]
	})

	test('legacyProductIds mode returns exactly the requested, deduplicated ids', () => {
		const criteria: SliceCriteria = { kind: 'legacyProductIds', legacyProductIds: [1, 1, 3] }
		expect(resolveLegacyProductIds(dump, criteria).sort()).toEqual([1, 3])
	})

	test('brandIds mode returns every product with a matching brandId', () => {
		const criteria: SliceCriteria = { kind: 'brandIds', brandIds: [10] }
		expect(resolveLegacyProductIds(dump, criteria).sort()).toEqual([1, 2])
	})

	test('legacyCategoryIds mode returns products matched via EITHER the primary categoryId or a product_categories junction row', () => {
		const criteria: SliceCriteria = { kind: 'legacyCategoryIds', legacyCategoryIds: [100] }
		// product 1 via primary categoryId=100, product 2 via junction row, product 3 via primary categoryId=100
		expect(resolveLegacyProductIds(dump, criteria).sort()).toEqual([1, 2, 3])
	})
})

describe('autoSelectDiverseSlice (Requirement 2: scenario coverage)', () => {
	// Legacy product id plan:
	//   1 -> Pass 0 confirmed multi-variant family (2/2 variables confirmed)
	//   2 -> Pass 0 partial family (2/3 variables confirmed)
	//   3 -> Pass 0 quarantined family (prior quarantine)
	//   4 -> hidden product (isShown=false), no 1C match
	//   5 -> standalone confirmed position
	//   6 -> barcode-only-duplicate ID_nom group (ambiguous position, never auto-merged)
	const dump = emptyDump({
		products: [
			makeLegacyProduct({ id: 1 }),
			makeLegacyProduct({ id: 2 }),
			makeLegacyProduct({ id: 3 }),
			makeLegacyProduct({ id: 4, isShown: false }),
			makeLegacyProduct({ id: 5, guid: '500' }),
			makeLegacyProduct({ id: 6, guid: '600' })
		],
		productVariables: [
			makeVariable({ id: 11, productId: 1, sku: '110' }),
			makeVariable({ id: 12, productId: 1, sku: '111' }),
			makeVariable({ id: 21, productId: 2, sku: '210' }),
			makeVariable({ id: 22, productId: 2, sku: '211' }),
			makeVariable({ id: 23, productId: 2 }),
			makeVariable({ id: 31, productId: 3, sku: '310' }),
			makeVariable({ id: 32, productId: 3, sku: '311' })
		]
	})
	const oneCRaw = [
		makeOneCRaw({ ID_nom: '110' }),
		makeOneCRaw({ ID_nom: '111' }),
		makeOneCRaw({ ID_nom: '210' }),
		makeOneCRaw({ ID_nom: '211' }),
		makeOneCRaw({ ID_nom: '500' }),
		makeOneCRaw({ ID_nom: '600', Barcode: 'barcode-variant-A' }),
		makeOneCRaw({ ID_nom: '600', Barcode: 'barcode-variant-B' })
	]
	const oneCRecords = parseOneC(oneCRaw)
	const priorQuarantine = new Map([[3, ['duplicate_guid' as const]]])
	const positions = reconcileSqlWith1c(dump, oneCRecords, priorQuarantine)
	const legacyVariantFamilies = reconcileLegacyVariantFamilies(dump, oneCRecords, priorQuarantine)
	const idNomDuplicates = classifyIdNomDuplicates(oneCRaw, 'ID_nom')

	test('reconciliation fixtures actually produce the intended classifications (sanity check on the fixtures themselves)', () => {
		const family1 = legacyVariantFamilies.families.find(f => f.legacyProductId === 1)
		const family2 = legacyVariantFamilies.families.find(f => f.legacyProductId === 2)
		const family3 = legacyVariantFamilies.families.find(f => f.legacyProductId === 3)
		expect(family1?.classification).toBe('confirmed')
		expect(family2?.classification).toBe('partial')
		expect(family3?.classification).toBe('quarantined')
		expect(idNomDuplicates.groups.find(g => g.idNom === '600')?.classification).toBe('barcode_only_conflict')
		const position6 = positions.mysqlResults.find(r => r.legacyProductId === 6)
		expect(position6?.outcome).toBe('ambiguous')
		expect(position6?.ambiguityReasonCode).toBe('duplicate_1c_records_on_single_key')
		const position5 = positions.mysqlResults.find(r => r.legacyProductId === 5)
		expect(position5?.outcome).toBe('confirmed')
	})

	test('selects exactly one legacy product id per scenario kind, with no scenario missing', () => {
		const result = autoSelectDiverseSlice({ dump, legacyVariantFamilies, positions, idNomDuplicates })
		expect(result.missingScenarios).toEqual([])
		const byKind = new Map(result.coverage.map(c => [c.kind, c.legacyProductId]))
		expect(byKind.get('confirmed_multi_variant_family')).toBe(1)
		expect(byKind.get('partial_family')).toBe(2)
		expect(byKind.get('quarantined_family')).toBe(3)
		expect(byKind.get('hidden_product')).toBe(4)
		expect(byKind.get('standalone')).toBe(5)
		expect(byKind.get('barcode_only_duplicate_group')).toBe(6)
		expect(result.legacyProductIds.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6])
	})

	test('the auto-selected ids feed straight into buildCatalogSlice and produce a consistent, reviewable slice', () => {
		const result = autoSelectDiverseSlice({ dump, legacyVariantFamilies, positions, idNomDuplicates })
		const slice = buildCatalogSlice(dump, result.legacyProductIds)
		expect(slice.products).toHaveLength(6)
		expect(slice.productVariables).toHaveLength(7)
	})

	test('reports a scenario as missing rather than fabricating a stand-in when the dump has no example of it', () => {
		const sparseDump = emptyDump({ products: [makeLegacyProduct({ id: 1 })] })
		const sparsePositions = reconcileSqlWith1c(sparseDump, [])
		const sparseFamilies = reconcileLegacyVariantFamilies(sparseDump, [])
		const sparseDuplicates = classifyIdNomDuplicates([], 'ID_nom')
		const result = autoSelectDiverseSlice({
			dump: sparseDump,
			legacyVariantFamilies: sparseFamilies,
			positions: sparsePositions,
			idNomDuplicates: sparseDuplicates
		})
		const expectedMissing: SliceScenarioKind[] = [
			'barcode_only_duplicate_group',
			'confirmed_multi_variant_family',
			'hidden_product',
			'partial_family',
			'quarantined_family',
			'standalone'
		]
		expect(result.missingScenarios.sort()).toEqual(expectedMissing.sort())
		expect(result.legacyProductIds).toEqual([])
	})
})

describe('buildSlicePreview (Requirement 4)', () => {
	beforeEach(async () => {
		await resetDatabase()
	})

	test('lists exactly the product/variant ids a dry run says would be written, with legacy key and pass origin', async () => {
		const dump = emptyDump({
			products: [makeLegacyProduct({ id: 201, guid: '20001', titleRu: 'Standalone Cream', uriRu: 'standalone-cream' })]
		})
		const oneCRaw = [makeOneCRaw({ ID_nom: '20001' })]
		const oneCRecords = parseOneC(oneCRaw)
		const input: CatalogImportInput = {
			dump,
			oneCRecords,
			families: reconcileFamilies(dump, oneCRecords),
			positions: reconcileSqlWith1c(dump, oneCRecords),
			idNomDuplicates: classifyIdNomDuplicates(oneCRaw, 'ID_nom')
		}

		const result = await db.transaction(tx => runCatalogImport(tx, input, 'dry-run'))

		const preview = buildSlicePreview(result)
		expect(preview.unitsThatWouldWrite).toBe(1)
		expect(preview.productIdsThatWouldBeWritten).toHaveLength(1)
		expect(preview.variantIdsThatWouldBeWritten).toHaveLength(1)
		const entry = preview.entries.find(e => e.action === 'created')!
		expect(entry.pass).toBe('pass2_standalone')
		expect(entry.legacyKey).toContain('20001')
	})
})

describe('computeSliceManifestHash / assertSliceConfirmed (Requirement 5 / Sprint 12B.6.1 Task 5)', () => {
	function manifestInputs(overrides: Partial<Parameters<typeof computeSliceManifestHash>[0]> = {}) {
		return {
			legacyProductIds: [1, 2, 3],
			slicedDump: emptyDump({}),
			relevantIdNoms: ['nom-1', 'nom-2'],
			importParams: { auto: false, legacyProductIds: '1,2,3', brandIds: null, legacyCategoryIds: null },
			...overrides
		}
	}

	test('is deterministic and order-independent on the legacy id selection', () => {
		expect(computeSliceManifestHash(manifestInputs({ legacyProductIds: [3, 1, 2] }))).toBe(
			computeSliceManifestHash(manifestInputs({ legacyProductIds: [1, 2, 3] }))
		)
		expect(computeSliceManifestHash(manifestInputs({ legacyProductIds: [1, 2, 3] }))).toBe(
			computeSliceManifestHash(manifestInputs({ legacyProductIds: [1, 1, 2, 3] }))
		)
	})

	test('differs for a different slice selection', () => {
		expect(computeSliceManifestHash(manifestInputs({ legacyProductIds: [1, 2, 3] }))).not.toBe(
			computeSliceManifestHash(manifestInputs({ legacyProductIds: [1, 2, 4] }))
		)
	})

	test('Task 5: differs when the sliced dump CONTENT changes, even with the identical legacy id selection', () => {
		const base = manifestInputs({ slicedDump: emptyDump({ products: [makeLegacyProduct({ id: 1, titleRu: 'Original title' })] }) })
		const changed = manifestInputs({ slicedDump: emptyDump({ products: [makeLegacyProduct({ id: 1, titleRu: 'Changed title' })] }) })
		expect(computeSliceManifestHash(base)).not.toBe(computeSliceManifestHash(changed))
	})

	test('Task 5: differs when the relevant 1C identities change, even with identical ids and dump', () => {
		const a = manifestInputs({ relevantIdNoms: ['nom-1'] })
		const b = manifestInputs({ relevantIdNoms: ['nom-1', 'nom-2'] })
		expect(computeSliceManifestHash(a)).not.toBe(computeSliceManifestHash(b))
	})

	test('Task 5: differs when import parameters change, even with identical ids, dump, and identities', () => {
		const a = manifestInputs({ importParams: { auto: false, legacyProductIds: '1,2,3', brandIds: null, legacyCategoryIds: null } })
		const b = manifestInputs({ importParams: { auto: true, legacyProductIds: null, brandIds: null, legacyCategoryIds: null } })
		expect(computeSliceManifestHash(a)).not.toBe(computeSliceManifestHash(b))
	})

	test('refuses (fails closed) with no confirmation hash supplied', () => {
		expect(() => assertSliceConfirmed(manifestInputs(), undefined)).toThrow(SliceConfirmationError)
	})

	test('refuses when the supplied hash does not match the slice actually being imported', () => {
		const wrongHash = computeSliceManifestHash(manifestInputs({ legacyProductIds: [9, 9, 9] }))
		expect(() => assertSliceConfirmed(manifestInputs(), wrongHash)).toThrow(SliceConfirmationError)
	})

	test('refuses when the input changed after confirmation, even though the legacy id selection stayed identical (Task 5/7)', () => {
		const confirmedAgainst = manifestInputs({ slicedDump: emptyDump({ products: [makeLegacyProduct({ id: 1, titleRu: 'Reviewed version' })] }) })
		const staleHash = computeSliceManifestHash(confirmedAgainst)
		const actuallyImporting = manifestInputs({ slicedDump: emptyDump({ products: [makeLegacyProduct({ id: 1, titleRu: 'Mutated after review' })] }) })
		expect(() => assertSliceConfirmed(actuallyImporting, staleHash)).toThrow(SliceConfirmationError)
	})

	test('succeeds only when the supplied hash exactly matches this slice', () => {
		const correctHash = computeSliceManifestHash(manifestInputs())
		expect(() => assertSliceConfirmed(manifestInputs(), correctHash)).not.toThrow()
	})
})
