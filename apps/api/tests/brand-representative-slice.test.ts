import { describe, expect, test } from 'bun:test'
import { selectBrandRepresentativeSlice } from '../src/import/brand-representative-slice'
import type { LegacyCatalogDump, LegacyProduct, LegacyProductVariable } from '../src/import/parsers/mysql-catalog'
import { parseProductsFeed, type ProductsFeedRecord } from '../src/import/parsers/products-feed'
import { reconcileSqlWith1c } from '../src/import/reconcile/sql-1c-reconciliation'
import { reconcileFamilies } from '../src/import/reconcile/family-reconciliation'
import { reconcileLegacyVariantFamilies } from '../src/import/reconcile/legacy-variant-family-reconciliation'
import { classifyIdNomDuplicates } from '../src/import/reconcile/duplicate-id-nom'
import type { QuarantineReasonCode } from '../src/import/dry-run-catalog'

/**
 * Sprint 12B.9: purely synthetic fixtures, same discipline as every other
 * Sprint 12 reconciliation test (no real legacy ids/SKUs/GUIDs/ID_noms, and
 * no real Pupa data - these numbers are invented, not scaled-down copies of
 * the real brandId=108 counts the user reported from their Windows run).
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

/**
 * Synthetic brand 777 legacy product id plan (10 products across 10 distinct
 * categories, so every mandatory scenario this sprint requires has exactly
 * one real candidate):
 *   1  -> standalone confirmed (category 50)
 *   2  -> standalone confirmed, lower-priority than 1 - left for the
 *         category-diversity fill step (category 51)
 *   3  -> Pass 0 confirmed family, 2 confirmed variants (category 52)
 *   4  -> Pass 0 confirmed family, 3 confirmed variants with 2 distinct
 *         shades AND 2 distinct volumes (category 53)
 *   5  -> Pass 0 partial family: 1 confirmed + 1 unconfirmed (no SKU) member
 *         (category 54)
 *   6  -> Pass 0 quarantined family (prior quarantine) (category 55)
 *   7  -> hidden product (isShown=false), no 1C match (category 56)
 *   8  -> barcode-only-duplicate ID_nom conflict (category 57)
 *   9  -> price-conflict ID_nom conflict (category 58)
 *   10 -> standalone confirmed with 2 product-level images (category 59)
 * Plus a second brand (888) with one unrelated product (100), to prove
 * brand scoping never leaks a different brand's product into the slice.
 */
function buildFixture(options: { priorQuarantine?: Map<number, QuarantineReasonCode[]>; dropMultiImage?: boolean; dropPriceConflict?: boolean } = {}) {
	const products: LegacyProduct[] = [
		makeLegacyProduct({ id: 1, guid: '1001', brandId: 777, categoryId: 50 }),
		makeLegacyProduct({ id: 2, guid: '1002', brandId: 777, categoryId: 51 }),
		makeLegacyProduct({ id: 3, titleRu: 'Family A', brandId: 777, categoryId: 52 }),
		makeLegacyProduct({ id: 4, titleRu: 'Family B', brandId: 777, categoryId: 53 }),
		makeLegacyProduct({ id: 5, titleRu: 'Family C (partial)', brandId: 777, categoryId: 54 }),
		makeLegacyProduct({ id: 6, titleRu: 'Family D (quarantined)', brandId: 777, categoryId: 55 }),
		makeLegacyProduct({ id: 7, brandId: 777, categoryId: 56, isShown: false }),
		makeLegacyProduct({ id: 8, guid: '8001', brandId: 777, categoryId: 57 }),
		makeLegacyProduct({ id: 9, guid: '9001', brandId: 777, categoryId: 58 }),
		makeLegacyProduct({ id: 10, guid: '10001', brandId: 777, categoryId: 59 }),
		makeLegacyProduct({ id: 100, guid: '100001', brandId: 888, categoryId: 999 })
	]

	const productVariables: LegacyProductVariable[] = [
		makeVariable({ id: 31, productId: 3, sku: '3001' }),
		makeVariable({ id: 32, productId: 3, sku: '3002' }),
		makeVariable({ id: 41, productId: 4, sku: '4001', colorRu: 'Red', volumeVar: '50ml' }),
		makeVariable({ id: 42, productId: 4, sku: '4002', colorRu: 'Blue', volumeVar: '50ml' }),
		makeVariable({ id: 43, productId: 4, sku: '4003', colorRu: 'Red', volumeVar: '100ml' }),
		makeVariable({ id: 51, productId: 5, sku: '5001' }),
		makeVariable({ id: 52, productId: 5, sku: '5002' }),
		makeVariable({ id: 53, productId: 5, sku: null }), // no SKU -> cannot be independently confirmed -> partial (2 confirmed / 1 unconfirmed)
		makeVariable({ id: 61, productId: 6, sku: '6001' }),
		makeVariable({ id: 62, productId: 6, sku: '6002' })
	]

	const productImgs = options.dropMultiImage
		? []
		: [
				{ id: 9001, productId: 10, img: 'a.jpg', sortOrder: 0, isShown: true },
				{ id: 9002, productId: 10, img: 'b.jpg', sortOrder: 1, isShown: true }
			]

	const dump = emptyDump({ products, productVariables, productImgs })

	const oneCRaw: Record<string, unknown>[] = [
		makeOneCRaw({ ID_nom: '1001' }),
		makeOneCRaw({ ID_nom: '1002' }),
		makeOneCRaw({ ID_nom: '3001' }),
		makeOneCRaw({ ID_nom: '3002' }),
		makeOneCRaw({ ID_nom: '4001' }),
		makeOneCRaw({ ID_nom: '4002' }),
		makeOneCRaw({ ID_nom: '4003' }),
		makeOneCRaw({ ID_nom: '5001' }),
		makeOneCRaw({ ID_nom: '5002' }),
		makeOneCRaw({ ID_nom: '6001' }),
		makeOneCRaw({ ID_nom: '6002' }),
		makeOneCRaw({ ID_nom: '8001', Barcode: 'barcode-variant-A' }),
		makeOneCRaw({ ID_nom: '8001', Barcode: 'barcode-variant-B' }),
		makeOneCRaw({ ID_nom: '10001' }),
		makeOneCRaw({ ID_nom: '100001' })
	]
	if (!options.dropPriceConflict) {
		oneCRaw.push(makeOneCRaw({ ID_nom: '9001', Price: 1000 }), makeOneCRaw({ ID_nom: '9001', Price: 2000 }))
	} else {
		oneCRaw.push(makeOneCRaw({ ID_nom: '9001', Price: 1000 }))
	}

	const oneCRecords = parseOneC(oneCRaw)
	const priorQuarantine = options.priorQuarantine ?? new Map([[6, ['duplicate_guid' as const]]])
	const positions = reconcileSqlWith1c(dump, oneCRecords, priorQuarantine)
	const families = reconcileFamilies(dump, oneCRecords, priorQuarantine)
	const legacyVariantFamilies = reconcileLegacyVariantFamilies(dump, oneCRecords, priorQuarantine)
	const idNomDuplicates = classifyIdNomDuplicates(oneCRaw, 'ID_nom')

	return { dump, oneCRecords, positions, families, legacyVariantFamilies, idNomDuplicates }
}

describe('selectBrandRepresentativeSlice', () => {
	test('sanity: the fixture actually produces the intended classifications before testing selection on top of it', () => {
		const { legacyVariantFamilies, idNomDuplicates } = buildFixture()
		const familyA = legacyVariantFamilies.families.find(f => f.legacyProductId === 3)
		const familyB = legacyVariantFamilies.families.find(f => f.legacyProductId === 4)
		const familyC = legacyVariantFamilies.families.find(f => f.legacyProductId === 5)
		const familyD = legacyVariantFamilies.families.find(f => f.legacyProductId === 6)
		expect(familyA?.classification).toBe('confirmed')
		expect(familyB?.classification).toBe('confirmed')
		expect(familyC?.classification).toBe('partial')
		expect(familyD?.classification).toBe('quarantined')
		expect(idNomDuplicates.groups.find(g => g.idNom === '8001')?.classification).toBe('barcode_only_conflict')
		expect(idNomDuplicates.groups.find(g => g.idNom === '9001')?.classification).toBe('price_conflict')
	})

	test('selects within the configured min/max bounds', () => {
		const { dump, legacyVariantFamilies, families, positions, idNomDuplicates } = buildFixture()
		const result = selectBrandRepresentativeSlice({ dump, brandId: 777, legacyVariantFamilies, families, positions, idNomDuplicates, minCount: 10, maxCount: 14 })
		expect(result.legacyProductIds.length).toBeGreaterThanOrEqual(10)
		expect(result.legacyProductIds.length).toBeLessThanOrEqual(14)
	})

	test('every mandatory scenario present in the fixture is represented, each with a non-empty, correctly-tagged reason list', () => {
		const { dump, legacyVariantFamilies, families, positions, idNomDuplicates } = buildFixture()
		const result = selectBrandRepresentativeSlice({ dump, brandId: 777, legacyVariantFamilies, families, positions, idNomDuplicates, minCount: 9, maxCount: 14 })

		const reasonKinds = new Set(result.selections.flatMap(s => s.reasons.map(r => r.kind)))
		for (const kind of [
			'standalone',
			'multi_variant_2',
			'multi_variant_3plus',
			'confirmed_family',
			'partial_family',
			'hidden_product',
			'quarantined_family',
			'id_nom_conflict_barcode_only',
			'id_nom_conflict_other',
			'multi_image',
			'shade_volume_spread'
		]) {
			expect(reasonKinds.has(kind as never)).toBe(true)
		}
		expect(result.missingCategories).toEqual([])

		// Every reason entry actually carries a detail string, never an empty placeholder.
		for (const selection of result.selections) {
			for (const reason of selection.reasons) {
				expect(reason.detail.length).toBeGreaterThan(0)
			}
		}

		// The hidden product (7) is represented under its own hidden_product reason.
		const hiddenSelection = result.selections.find(s => s.legacyProductId === 7)
		expect(hiddenSelection?.reasons.some(r => r.kind === 'hidden_product')).toBe(true)

		// Product 4's family shows a genuine shade+volume spread.
		const shadeVolumeSelection = result.selections.find(s => s.legacyProductId === 4)
		expect(shadeVolumeSelection?.reasons.some(r => r.kind === 'shade_volume_spread')).toBe(true)
	})

	test('never includes a product belonging to a different brand', () => {
		const { dump, legacyVariantFamilies, families, positions, idNomDuplicates } = buildFixture()
		const result = selectBrandRepresentativeSlice({ dump, brandId: 777, legacyVariantFamilies, families, positions, idNomDuplicates, minCount: 20, maxCount: 20 })
		expect(result.legacyProductIds).not.toContain(100)
		expect(result.totalBrandProducts).toBe(10)
	})

	test('every selected legacy id is a real input id - never fabricated', () => {
		const { dump, legacyVariantFamilies, families, positions, idNomDuplicates } = buildFixture()
		const realIds = new Set(dump.products.map(p => p.id))
		const result = selectBrandRepresentativeSlice({ dump, brandId: 777, legacyVariantFamilies, families, positions, idNomDuplicates, minCount: 10, maxCount: 14 })
		for (const id of result.legacyProductIds) expect(realIds.has(id)).toBe(true)
	})

	test('reports a mandatory scenario as explicitly missing, rather than crashing or silently omitting it, when the fixture genuinely has no candidate', () => {
		const { dump, legacyVariantFamilies, families, positions, idNomDuplicates } = buildFixture({ dropMultiImage: true, dropPriceConflict: true })
		const result = selectBrandRepresentativeSlice({ dump, brandId: 777, legacyVariantFamilies, families, positions, idNomDuplicates, minCount: 8, maxCount: 14 })
		expect(result.missingCategories).toContain('multi_image')
		expect(result.missingCategories).toContain('id_nom_conflict_other')
		// Every other mandatory scenario, which the fixture still has a real candidate for, must still be found.
		expect(result.missingCategories).not.toContain('standalone')
		expect(result.missingCategories).not.toContain('hidden_product')
		expect(result.missingCategories).not.toContain('quarantined_family')
	})

	test('reports a mandatory scenario as missing when the whole brand genuinely has none (no hidden products anywhere)', () => {
		const { dump, legacyVariantFamilies, families, positions, idNomDuplicates } = buildFixture()
		const withoutHidden = { ...dump, products: dump.products.map(p => (p.id === 7 ? { ...p, isShown: true } : p)) }
		const result = selectBrandRepresentativeSlice({
			dump: withoutHidden,
			brandId: 777,
			legacyVariantFamilies,
			families,
			positions,
			idNomDuplicates,
			minCount: 8,
			maxCount: 14
		})
		expect(result.missingCategories).toContain('hidden_product')
	})

	test('is deterministic: running the same input twice produces an identical selection', () => {
		const { dump, legacyVariantFamilies, families, positions, idNomDuplicates } = buildFixture()
		const inputs = { dump, brandId: 777, legacyVariantFamilies, families, positions, idNomDuplicates, minCount: 9, maxCount: 14 }
		const first = selectBrandRepresentativeSlice(inputs)
		const second = selectBrandRepresentativeSlice(inputs)
		expect(first.legacyProductIds).toEqual(second.legacyProductIds)
		expect(first.selections).toEqual(second.selections)
	})

	test('never drops a mandatory-reason selection to satisfy maxCount, even when the mandatory set alone exceeds it', () => {
		const { dump, legacyVariantFamilies, families, positions, idNomDuplicates } = buildFixture()
		const result = selectBrandRepresentativeSlice({ dump, brandId: 777, legacyVariantFamilies, families, positions, idNomDuplicates, minCount: 5, maxCount: 6 })
		// 9 distinct products carry at least one mandatory reason in this fixture (1,3,4,5,6,7,8,9,10) - all must survive even though maxCount=6.
		expect(result.legacyProductIds.length).toBeGreaterThanOrEqual(9)
		for (const selection of result.selections) {
			expect(selection.reasons.some(r => r.kind !== 'category_diversity_fill')).toBe(true)
		}
	})

	test('throws when minCount exceeds maxCount', () => {
		const { dump, legacyVariantFamilies, families, positions, idNomDuplicates } = buildFixture()
		expect(() =>
			selectBrandRepresentativeSlice({ dump, brandId: 777, legacyVariantFamilies, families, positions, idNomDuplicates, minCount: 10, maxCount: 5 })
		).toThrow()
	})

	test('the resulting slice is a valid, FK-closed LegacyCatalogDump covering exactly the selected ids', () => {
		const { dump, legacyVariantFamilies, families, positions, idNomDuplicates } = buildFixture()
		const result = selectBrandRepresentativeSlice({ dump, brandId: 777, legacyVariantFamilies, families, positions, idNomDuplicates, minCount: 9, maxCount: 14 })
		expect(result.slice.products.map(p => p.id).sort((a, b) => a - b)).toEqual([...result.legacyProductIds].sort((a, b) => a - b))
	})
})
