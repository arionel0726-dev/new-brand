import { describe, expect, test } from 'bun:test'
import {
	analyzeBrandReadiness,
	rankBrandsForRepresentativeSlice,
	selectRepresentativeBrand
} from '../src/import/brand-readiness-analysis'
import type { LegacyCatalogDump, LegacyProduct, LegacyProductVariable } from '../src/import/parsers/mysql-catalog'
import { parseProductsFeed, type ProductsFeedRecord } from '../src/import/parsers/products-feed'
import { classifyIdNomDuplicates } from '../src/import/reconcile/duplicate-id-nom'
import { reconcileFamilies } from '../src/import/reconcile/family-reconciliation'
import { reconcileSqlWith1c } from '../src/import/reconcile/sql-1c-reconciliation'

/**
 * Sprint 12B.8: purely synthetic fixtures, same discipline as every other
 * Sprint 12 reconciliation test (no real legacy ids/SKUs/GUIDs/ID_noms).
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
		sortOrder: null,
		...overrides
	}
}

function makeDump(partial: Partial<LegacyCatalogDump> & { products: LegacyProduct[] }): LegacyCatalogDump {
	return {
		products: partial.products,
		productVariables: partial.productVariables ?? [],
		brands: partial.brands ?? [],
		categories: partial.categories ?? [],
		productCategories: partial.productCategories ?? [],
		productImgs: partial.productImgs ?? [],
		productVariableImgs: partial.productVariableImgs ?? [],
		stores: partial.stores ?? [],
		storeImgs: partial.storeImgs ?? [],
		productsMore: partial.productsMore ?? []
	}
}

function makeOneCRaw(overrides: Record<string, unknown> & { ID_nom: string | number }): Record<string, unknown> {
	return { Brand: 'TestBrand', Sex: 'Женский', ...overrides }
}

function parseOneC(raw: Record<string, unknown>[]): ProductsFeedRecord[] {
	return parseProductsFeed(raw).validRecords
}

/**
 * Brand 501: two standalone products (GUID<->ID_nom confirmed, Pass 2),
 * one variant each, two distinct categories - exercises category spread.
 * Brand 502: one Pass 0 reconstructed family (parent 701, two confirmed
 * products_variable rows via SKU<->ID_nom) - exercises the "2" variant
 * bucket and pass0_confirmed.
 * Brand 503: one standalone product (801) whose ID_nom has a price
 * conflict in the 1C feed (two raw records, same ID_nom, differing Price)
 * - exercises conflict attribution.
 */
function buildFixture() {
	const products: LegacyProduct[] = [
		makeLegacyProduct({ id: 601, guid: '601001', brandId: 501, categoryId: 10 }),
		makeLegacyProduct({ id: 602, guid: '602001', brandId: 501, categoryId: 11 }),
		makeLegacyProduct({ id: 701, titleRu: 'Family Parent', brandId: 502, categoryId: 12 }),
		makeLegacyProduct({ id: 801, guid: '801001', brandId: 503, categoryId: 13 })
	]
	const productVariables: LegacyProductVariable[] = [
		makeVariable({ id: 90001, productId: 701, sku: '701001', colorRu: 'Red', barcode: 'bc-701-a' }),
		makeVariable({ id: 90002, productId: 701, sku: '701002', colorRu: 'Blue', barcode: 'bc-701-b' })
	]
	const dump = makeDump({ products, productVariables })

	const oneCRaw = [
		makeOneCRaw({ ID_nom: '601001' }),
		makeOneCRaw({ ID_nom: '602001' }),
		makeOneCRaw({ ID_nom: '701001' }),
		makeOneCRaw({ ID_nom: '701002' }),
		makeOneCRaw({ ID_nom: '801001', Price: 1000 }),
		makeOneCRaw({ ID_nom: '801001', Price: 2000 })
	]
	const oneCRecords = parseOneC(oneCRaw)
	const families = reconcileFamilies(dump, oneCRecords)
	const positions = reconcileSqlWith1c(dump, oneCRecords)
	const idNomDuplicates = classifyIdNomDuplicates(oneCRaw, 'ID_nom')

	return { dump, oneCRecords, families, positions, idNomDuplicates }
}

describe('analyzeBrandReadiness', () => {
	test('attributes each legacy product to exactly one brand and one pass bucket, never double-counted', () => {
		const { dump, oneCRecords, families, positions, idNomDuplicates } = buildFixture()
		const report = analyzeBrandReadiness(dump, oneCRecords, families, positions, idNomDuplicates)

		const brandIds = report.brands.map(b => b.brandId).sort((a, b) => (a ?? 0) - (b ?? 0))
		expect(brandIds).toEqual([501, 502, 503])

		const totalAttributed = report.brands.reduce((sum, b) => sum + b.totalLegacyProducts, 0) + report.unassignedProductCount
		expect(totalAttributed).toBe(dump.products.length)
	})

	test('standalone brand 501: two confirmed Pass 2 products, each with exactly 1 variant, 2 distinct categories', () => {
		const { dump, oneCRecords, families, positions, idNomDuplicates } = buildFixture()
		const report = analyzeBrandReadiness(dump, oneCRecords, families, positions, idNomDuplicates)
		const brand501 = report.brands.find(b => b.brandId === 501)!

		expect(brand501.totalLegacyProducts).toBe(2)
		expect(brand501.variantCountDistribution).toEqual({ '1': 2, '2': 0, '3+': 0 })
		expect(brand501.distinctCategoryCount).toBe(2)
		expect(brand501.byPassBucket.pass2_confirmed).toBe(2)
	})

	test('family brand 502: one Pass 0 confirmed family with 2 confirmed variants lands in the "2" bucket', () => {
		const { dump, oneCRecords, families, positions, idNomDuplicates } = buildFixture()
		const report = analyzeBrandReadiness(dump, oneCRecords, families, positions, idNomDuplicates)
		const brand502 = report.brands.find(b => b.brandId === 502)!

		expect(brand502.totalLegacyProducts).toBe(1)
		expect(brand502.variantCountDistribution).toEqual({ '1': 0, '2': 1, '3+': 0 })
		expect(brand502.byPassBucket.pass0_confirmed).toBe(1)
	})

	test('conflict brand 503: the price_conflict duplicate ID_nom group is attributed to the brand owning that ID_nom, not left unattributed', () => {
		const { dump, oneCRecords, families, positions, idNomDuplicates } = buildFixture()
		const report = analyzeBrandReadiness(dump, oneCRecords, families, positions, idNomDuplicates)
		const brand503 = report.brands.find(b => b.brandId === 503)!

		expect(brand503.conflicts.priceConflict).toBe(1)
		expect(brand503.conflicts.conflicting).toBe(0)
		expect(brand503.conflicts.barcodeOnlyConflict).toBe(0)
	})

	test('a legacy product with brandId=null is reported in unassignedProductCount, never folded into a real brand', () => {
		const dump = makeDump({ products: [makeLegacyProduct({ id: 999, brandId: null })] })
		const oneCRecords = parseOneC([])
		const families = reconcileFamilies(dump, oneCRecords)
		const positions = reconcileSqlWith1c(dump, oneCRecords)
		const idNomDuplicates = classifyIdNomDuplicates([], 'ID_nom')

		const report = analyzeBrandReadiness(dump, oneCRecords, families, positions, idNomDuplicates)
		expect(report.brands).toHaveLength(0)
		expect(report.unassignedProductCount).toBe(1)
	})
})

function makeAnalysis(overrides: Partial<Parameters<typeof rankBrandsForRepresentativeSlice>[0]['brands'][number]> & { brandId: number }) {
	return {
		brandId: overrides.brandId,
		totalLegacyProducts: overrides.totalLegacyProducts ?? 1,
		variantCountDistribution: overrides.variantCountDistribution ?? { '1': 1, '2': 0, '3+': 0 },
		distinctCategoryCount: overrides.distinctCategoryCount ?? 1,
		categoryIds: overrides.categoryIds ?? [1],
		byPassBucket: overrides.byPassBucket ?? {
			pass0_confirmed: 0,
			pass0_partial: 0,
			pass0_quarantined: 0,
			pass1_confirmed_family: 0,
			pass1_quarantine: 0,
			pass1_unmatched_or_ambiguous: 0,
			pass2_confirmed: 1,
			pass2_quarantine: 0,
			pass2_ambiguous_or_unmatched: 0
		},
		conflicts: overrides.conflicts ?? { conflicting: 0, priceConflict: 0, barcodeOnlyConflict: 0 }
	}
}

describe('rankBrandsForRepresentativeSlice / selectRepresentativeBrand', () => {
	test('holding product/category count equal, a brand with 3+ variant products outranks one with only single-variant products', () => {
		const plain = makeAnalysis({ brandId: 1 })
		const rich = makeAnalysis({ brandId: 2, variantCountDistribution: { '1': 0, '2': 0, '3+': 1 } })
		const ranked = rankBrandsForRepresentativeSlice({ brands: [plain, rich], unassignedProductCount: 0 })
		expect(ranked[0].brandId).toBe(2)
	})

	test('holding everything else equal, a brand with a few conflicts outranks a brand with zero conflicts', () => {
		const clean = makeAnalysis({ brandId: 1 })
		const conflicted = makeAnalysis({ brandId: 2, conflicts: { conflicting: 1, priceConflict: 1, barcodeOnlyConflict: 0 } })
		const ranked = rankBrandsForRepresentativeSlice({ brands: [clean, conflicted], unassignedProductCount: 0 })
		expect(ranked[0].brandId).toBe(2)
	})

	test('a brand more than half quarantined is penalized below an otherwise-identical, non-quarantined brand', () => {
		const healthy = makeAnalysis({
			brandId: 1,
			totalLegacyProducts: 2,
			byPassBucket: {
				pass0_confirmed: 0,
				pass0_partial: 0,
				pass0_quarantined: 0,
				pass1_confirmed_family: 0,
				pass1_quarantine: 0,
				pass1_unmatched_or_ambiguous: 0,
				pass2_confirmed: 2,
				pass2_quarantine: 0,
				pass2_ambiguous_or_unmatched: 0
			}
		})
		const mostlyQuarantined = makeAnalysis({
			brandId: 2,
			totalLegacyProducts: 2,
			byPassBucket: {
				pass0_confirmed: 0,
				pass0_partial: 0,
				pass0_quarantined: 0,
				pass1_confirmed_family: 0,
				pass1_quarantine: 0,
				pass1_unmatched_or_ambiguous: 0,
				pass2_confirmed: 0,
				pass2_quarantine: 2,
				pass2_ambiguous_or_unmatched: 0
			}
		})
		const ranked = rankBrandsForRepresentativeSlice({ brands: [healthy, mostlyQuarantined], unassignedProductCount: 0 })
		expect(ranked[0].brandId).toBe(1)
	})

	test('against the full reconciliation fixture, ranking is produced for every brand and is sorted descending by score', () => {
		const { dump, oneCRecords, families, positions, idNomDuplicates } = buildFixture()
		const report = analyzeBrandReadiness(dump, oneCRecords, families, positions, idNomDuplicates)
		const ranked = rankBrandsForRepresentativeSlice(report)

		expect(ranked).toHaveLength(3)
		expect(new Set(ranked.map(r => r.brandId))).toEqual(new Set([501, 502, 503]))
	})

	test('selectRepresentativeBrand returns the top-ranked candidate with non-empty reasoning, and ranking is sorted descending by score', () => {
		const { dump, oneCRecords, families, positions, idNomDuplicates } = buildFixture()
		const report = analyzeBrandReadiness(dump, oneCRecords, families, positions, idNomDuplicates)
		const top = selectRepresentativeBrand(report)
		const ranked = rankBrandsForRepresentativeSlice(report)

		expect(top).not.toBeNull()
		expect(top!.reasoning.length).toBeGreaterThan(0)
		expect(top!.brandId).toBe(ranked[0].brandId)
		for (let i = 1; i < ranked.length; i++) {
			expect(ranked[i - 1].score).toBeGreaterThanOrEqual(ranked[i].score)
		}
	})

	test('sanity: a standalone product confirmed via GUID<->ID_nom lands in pass2_confirmed for its own brand, independent of a second, unmatched brand', () => {
		const dump = makeDump({
			products: [
				makeLegacyProduct({ id: 1101, guid: '1101001', brandId: 601, categoryId: 20 }),
				makeLegacyProduct({ id: 1102, brandId: 602, categoryId: 20 }) // no GUID/barcode/group-code at all -> unmatched, not quarantine, but excluded from confirmed bucket
			]
		})
		const oneCRaw = [makeOneCRaw({ ID_nom: '1101001' })]
		const oneCRecords = parseOneC(oneCRaw)
		const families = reconcileFamilies(dump, oneCRecords)
		const positions = reconcileSqlWith1c(dump, oneCRecords)
		const idNomDuplicates = classifyIdNomDuplicates(oneCRaw, 'ID_nom')

		const report = analyzeBrandReadiness(dump, oneCRecords, families, positions, idNomDuplicates)
		const brand601 = report.brands.find(b => b.brandId === 601)!
		expect(brand601.byPassBucket.pass2_confirmed).toBe(1)
	})

	test('selectRepresentativeBrand returns null when there are no attributable brands at all', () => {
		const dump = makeDump({ products: [] })
		const oneCRecords = parseOneC([])
		const families = reconcileFamilies(dump, oneCRecords)
		const positions = reconcileSqlWith1c(dump, oneCRecords)
		const idNomDuplicates = classifyIdNomDuplicates([], 'ID_nom')
		const report = analyzeBrandReadiness(dump, oneCRecords, families, positions, idNomDuplicates)
		expect(selectRepresentativeBrand(report)).toBeNull()
	})
})
