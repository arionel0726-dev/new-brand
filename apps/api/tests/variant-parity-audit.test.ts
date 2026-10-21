import { describe, expect, test } from 'bun:test'
import {
	buildMissingVariantExamples,
	buildVariantParityReport,
	computeFamilyParityDiagnostics,
	computeLegacyCounts,
	computeV2PlanCounts,
	formatVariantParityReportMarkdown,
	matchLegacyVariants,
	summarizeLegacyVariantMatches
} from '../src/import/variant-parity-audit'
import type { LegacyCatalogDump, LegacyProduct, LegacyProductVariable } from '../src/import/parsers/mysql-catalog'
import { parseProductsFeed, type ProductsFeedRecord } from '../src/import/parsers/products-feed'
import { reconcileFamilies } from '../src/import/reconcile/family-reconciliation'
import { reconcileSqlWith1c } from '../src/import/reconcile/sql-1c-reconciliation'

/**
 * Sprint 12B.4.1 - synthetic fixtures only, no real legacy data. This
 * sprint builds a strictly READ-ONLY diagnostic CLI and does NOT change
 * any existing matching algorithm - `reconcileFamilies`/`reconcileSqlWith1c`
 * are called here exactly as they are everywhere else in the codebase.
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
		brands: [],
		categories: [],
		productCategories: [],
		productImgs: [],
		productVariableImgs: partial.productVariableImgs ?? [],
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

describe('computeLegacyCounts', () => {
	test('counts parent products (group-code-shaped sku), variants, multi-variant parents, published/usable variants', () => {
		const products = [
			makeLegacyProduct({ id: 1, sku: 'A10.XXX' }), // parent (group code)
			makeLegacyProduct({ id: 2, sku: '12345' }) // standalone - numeric sku, no dot, not a group code
		]
		const variables = [
			makeVariable({ id: 10, productId: 1, sku: '10568', isShown: true, barcode: 'BC1' }),
			makeVariable({ id: 11, productId: 1, sku: '10516', isShown: false, barcode: null }),
			makeVariable({ id: 12, productId: 2, sku: null, barcode: null, isShown: true }) // no usable sku/barcode
		]
		const dump = makeDump({ products, productVariables: variables })
		const counts = computeLegacyCounts(dump)

		expect(counts.legacyParentProducts).toBe(1)
		expect(counts.legacyVariants).toBe(3)
		expect(counts.parentsWithTwoPlusVariants).toBe(1)
		expect(counts.publishedLegacyVariants).toBe(2)
		expect(counts.variantsWithUsableSkuOrBarcode).toBe(2)
	})
})

describe('matchLegacyVariants', () => {
	test('confirmed: variant SKU uniquely equals a 1C ID_nom (SKU-as-ID_nom, per the forensic audit finding)', () => {
		const dump = makeDump({
			products: [makeLegacyProduct({ id: 1 })],
			productVariables: [makeVariable({ id: 10, productId: 1, sku: '10568' })]
		})
		const oneC = parseOneC([makeOneCRaw({ ID_nom: '10568' })])
		const results = matchLegacyVariants(dump, oneC)
		expect(results).toHaveLength(1)
		expect(results[0].outcome).toBe('confirmed')
		expect(results[0].matchedIdNoms).toEqual(['10568'])
		expect(results[0].basis).toContain('sku_as_id_nom')
	})

	test('ambiguous: SKU and barcode point at two different 1C ID_noms', () => {
		const dump = makeDump({
			products: [makeLegacyProduct({ id: 1 })],
			productVariables: [makeVariable({ id: 10, productId: 1, sku: '10568', barcode: 'BC-OTHER' })]
		})
		const oneC = parseOneC([makeOneCRaw({ ID_nom: '10568' }), makeOneCRaw({ ID_nom: '99999', Barcode: 'BC-OTHER' })])
		const results = matchLegacyVariants(dump, oneC)
		expect(results[0].outcome).toBe('ambiguous')
		expect(results[0].matchedIdNoms.sort()).toEqual(['10568', '99999'])
	})

	test('unmatched: no 1C record on SKU-as-ID_nom or barcode', () => {
		const dump = makeDump({
			products: [makeLegacyProduct({ id: 1 })],
			productVariables: [makeVariable({ id: 10, productId: 1, sku: 'no-such-id-nom', barcode: 'no-such-barcode' })]
		})
		const oneC = parseOneC([makeOneCRaw({ ID_nom: '10568' })])
		const results = matchLegacyVariants(dump, oneC)
		expect(results[0].outcome).toBe('unmatched')
	})

	test('orphan: the variant row\'s own product_id does not exist anywhere in the parsed dump', () => {
		const dump = makeDump({
			products: [makeLegacyProduct({ id: 1 })],
			productVariables: [makeVariable({ id: 10, productId: 999, sku: '10568' })]
		})
		const oneC = parseOneC([makeOneCRaw({ ID_nom: '10568' })])
		const results = matchLegacyVariants(dump, oneC)
		expect(results[0].outcome).toBe('orphan')
		expect(results[0].matchedIdNoms).toEqual([])
	})
})

describe('computeV2PlanCounts: confirmed multi-variant family end-to-end', () => {
	test('a 3-member confirmed family (A10.XXX, corroborated by barcode) plans 1 product with 3 variants; a standalone product plans 1+1', () => {
		const products = [
			makeLegacyProduct({ id: 101, sku: 'A10.XXX', guid: '101', barcode: '4051761201249' }),
			makeLegacyProduct({ id: 102, sku: 'A10.XXX', guid: '102', barcode: '4051761201232' }),
			makeLegacyProduct({ id: 103, sku: 'A10.XXX', guid: '103', barcode: '4051761202772' }),
			makeLegacyProduct({ id: 200, sku: '55555', guid: '55555' }) // standalone: guid === its own 1C ID_nom
		]
		const dump = makeDump({ products })
		const oneC = parseOneC([
			makeOneCRaw({ ID_nom: '10568', VariativeNomenclature: 'A10.XXX', Barcode: '4051761201249' }),
			makeOneCRaw({ ID_nom: '10516', VariativeNomenclature: 'A10.XXX', Barcode: '4051761201232' }),
			makeOneCRaw({ ID_nom: '10559', VariativeNomenclature: 'A10.XXX', Barcode: '4051761202772' }),
			makeOneCRaw({ ID_nom: '55555' })
		])

		const familyResult = reconcileFamilies(dump, oneC)
		const positionResult = reconcileSqlWith1c(dump, oneC)
		const family = familyResult.families.find(f => f.normalizedCode === 'A10.XXX')
		expect(family?.outcome).toBe('confirmed_family') // sanity: this fixture is proven elsewhere (catalog-importer.test.ts) to reach confirmed_family

		const plan = computeV2PlanCounts(dump, familyResult, positionResult)
		expect(plan.products).toBe(2) // 1 family product + 1 standalone product
		expect(plan.variants).toBe(4) // 3 family variants + 1 standalone variant
		expect(plan.productsWithTwoPlusVariants).toBe(1) // only the family product has 2+
	})
})

describe('computeFamilyParityDiagnostics', () => {
	test('a member whose own GUID points outside the family flips the WHOLE family to ambiguous_family (contradiction), rather than being individually excluded from an otherwise-confirmed family', () => {
		const products = [
			makeLegacyProduct({ id: 101, sku: 'A10.XXX', guid: '101', barcode: '4051761201249' }),
			makeLegacyProduct({ id: 102, sku: 'A10.XXX', guid: '102', barcode: '4051761201232' }),
			makeLegacyProduct({ id: 103, sku: 'A10.XXX', guid: '103', barcode: '4051761202772' }),
			// Member of the SAME family (same sku group code) whose own GUID
			// points at a standalone 1C record OUTSIDE the family.
			makeLegacyProduct({ id: 104, sku: 'A10.XXX', guid: '99999', barcode: null })
		]
		const dump = makeDump({ products })
		const oneC = parseOneC([
			makeOneCRaw({ ID_nom: '10568', VariativeNomenclature: 'A10.XXX', Barcode: '4051761201249' }),
			makeOneCRaw({ ID_nom: '10516', VariativeNomenclature: 'A10.XXX', Barcode: '4051761201232' }),
			makeOneCRaw({ ID_nom: '10559', VariativeNomenclature: 'A10.XXX', Barcode: '4051761202772' }),
			makeOneCRaw({ ID_nom: '99999' }) // standalone, no VariativeNomenclature - never enters the family index
		])

		const familyResult = reconcileFamilies(dump, oneC)
		const positionResult = reconcileSqlWith1c(dump, oneC)
		const family = familyResult.families.find(f => f.normalizedCode === 'A10.XXX')
		// Member 104's contradiction (its GUID evidence points at ID_nom
		// '99999', outside this family's 1C member set) flips the ENTIRE
		// family's outcome to 'ambiguous_family' - `reconcileFamilies`'
		// corroboration/contradiction check is family-wide, not per-member.
		expect(family?.outcome).toBe('ambiguous_family')
		expect(family?.collisionRisk).toBe(true)

		const diagnostics = computeFamilyParityDiagnostics(familyResult, positionResult)
		// Both counters stay 0 here: the family itself no longer reads as
		// confirmed_family, so neither diagnostic even looks at its members.
		expect(diagnostics.familiesWhoseMembersAppearAsSeparateV2Products).toBe(0)
		expect(diagnostics.familyMembersEligibleForStandaloneButPreempted).toBe(0)

		// And the importer's own Pass 1/Pass 2 routing agrees: since the
		// family is not confirmed_family, Pass 1 still claims every member
		// (handledLegacyIds) but writes nothing for this family at all - all
		// 4 members (101-104) are silently dropped, not just 104.
		const plan = computeV2PlanCounts(dump, familyResult, positionResult)
		expect(plan.products).toBe(0)
		expect(plan.variants).toBe(0)
	})

	test('familyMembersEligibleForStandaloneButPreempted is provably always 0 under the current code: a confirmed_family (no contradictions, by definition) can only exclude a member via no-evidence (unmatched_position) or multiple family-internal candidates (ambiguous_position) - and both cases use the exact same GUID/barcode indices reconcileSqlWith1c uses globally, so the same member can never independently read as a unique global "confirmed" match either', () => {
		const products = [
			makeLegacyProduct({ id: 201, sku: 'B20.YYY', guid: '201', barcode: '1111111111111' }),
			makeLegacyProduct({ id: 202, sku: 'B20.YYY', guid: '202', barcode: '2222222222222' }),
			// No GUID, no barcode at all - contributes nothing to corroboration
			// or contradiction, so the family stays confirmed_family, but this
			// member itself has zero evidence anywhere (family or global).
			makeLegacyProduct({ id: 203, sku: 'B20.YYY', guid: null, barcode: null })
		]
		const dump = makeDump({ products })
		const oneC = parseOneC([
			makeOneCRaw({ ID_nom: '20001', VariativeNomenclature: 'B20.YYY', Barcode: '1111111111111' }),
			makeOneCRaw({ ID_nom: '20002', VariativeNomenclature: 'B20.YYY', Barcode: '2222222222222' }),
			makeOneCRaw({ ID_nom: '20003', VariativeNomenclature: 'B20.YYY' })
		])

		const familyResult = reconcileFamilies(dump, oneC)
		const positionResult = reconcileSqlWith1c(dump, oneC)
		const family = familyResult.families.find(f => f.normalizedCode === 'B20.YYY')
		expect(family?.outcome).toBe('confirmed_family')
		expect(family?.collisionRisk).toBe(false)

		const position203 = familyResult.positions.find(p => p.mysqlProductId === 203)
		expect(position203?.outcome).toBe('unmatched_position') // no evidence, not contradicted

		const global203 = positionResult.mysqlResults.find(r => r.legacyProductId === 203)
		expect(global203?.outcome).toBe('unmatched') // same lack of evidence globally - never 'confirmed'

		const diagnostics = computeFamilyParityDiagnostics(familyResult, positionResult)
		expect(diagnostics.familiesWhoseMembersAppearAsSeparateV2Products).toBe(0)
		expect(diagnostics.familyMembersEligibleForStandaloneButPreempted).toBe(0)
	})
})

describe('buildMissingVariantExamples', () => {
	test('a 3-variable legacy family represented by only 1 V2 variant yields examples tagged with the correct reason per variable', () => {
		const products = [makeLegacyProduct({ id: 1, sku: null, guid: '7001' })]
		const variables = [
			makeVariable({ id: 10, productId: 1, sku: '7001' }), // same as the parent's own confirmed match - "already represented"
			makeVariable({ id: 11, productId: 1, sku: 'no-1c-record-for-this' }), // unmatched -> existing in legacy, absent from 1C
			makeVariable({ id: 12, productId: 1, sku: '7002', barcode: 'BC-ALT' }) // sku matches one, barcode matches a different one -> ambiguous
		]
		const dump = makeDump({ products, productVariables: variables })
		const oneC = parseOneC([makeOneCRaw({ ID_nom: '7001' }), makeOneCRaw({ ID_nom: '7002' }), makeOneCRaw({ ID_nom: '9999', Barcode: 'BC-ALT' })])

		const positionResult = reconcileSqlWith1c(dump, oneC)
		const matches = matchLegacyVariants(dump, oneC)
		const v2CountByProduct = new Map([[1, 1]]) // only 1 of 3 legacy variables ended up represented

		const examples = buildMissingVariantExamples(dump, matches, positionResult, v2CountByProduct)
		expect(examples.length).toBeGreaterThan(0)

		const byVariableId = new Map(examples.map(e => [e.legacyVariableId, e]))
		expect(byVariableId.get(10)?.reason).toBe('already_represented_elsewhere_in_v2')
		expect(byVariableId.get(11)?.reason).toBe('existing_in_legacy_absent_from_1c')
		expect(byVariableId.get(12)?.reason).toBe('present_in_1c_not_reconciled')
	})

	test('a quarantined parent product reports "quarantined" regardless of individual variant match quality', () => {
		const products = [makeLegacyProduct({ id: 1, sku: null, guid: '7001' })]
		const variables = [makeVariable({ id: 10, productId: 1, sku: '7001' }), makeVariable({ id: 11, productId: 1, sku: '7002' })]
		const dump = makeDump({ products, productVariables: variables })
		const oneC = parseOneC([makeOneCRaw({ ID_nom: '7001' }), makeOneCRaw({ ID_nom: '7002' })])

		const priorQuarantine = new Map([[1, ['duplicate_guid' as const]]])
		const positionResult = reconcileSqlWith1c(dump, oneC, priorQuarantine)
		const matches = matchLegacyVariants(dump, oneC)
		const examples = buildMissingVariantExamples(dump, matches, positionResult, new Map([[1, 0]]))

		expect(examples.length).toBeGreaterThan(0)
		for (const ex of examples) expect(ex.reason).toBe('quarantined')
	})

	test('never exceeds the requested limit, even with many eligible multi-variant families', () => {
		const products: LegacyProduct[] = []
		const variables: LegacyProductVariable[] = []
		const oneCRaw: Record<string, unknown>[] = []
		for (let i = 0; i < 15; i++) {
			products.push(makeLegacyProduct({ id: i, sku: null, guid: String(1000 + i) }))
			variables.push(makeVariable({ id: i * 10, productId: i, sku: String(1000 + i) }))
			variables.push(makeVariable({ id: i * 10 + 1, productId: i, sku: `unmatched-${i}` }))
			oneCRaw.push(makeOneCRaw({ ID_nom: String(1000 + i) }))
		}
		const dump = makeDump({ products, productVariables: variables })
		const oneC = parseOneC(oneCRaw)
		const positionResult = reconcileSqlWith1c(dump, oneC)
		const matches = matchLegacyVariants(dump, oneC)
		const v2CountByProduct = new Map(products.map(p => [p.id, 1]))

		const examples = buildMissingVariantExamples(dump, matches, positionResult, v2CountByProduct, 10)
		expect(examples.length).toBeLessThanOrEqual(10)
	})
})

describe('buildVariantParityReport + formatVariantParityReportMarkdown (end-to-end)', () => {
	test('composes counts, match summary, family diagnostics and examples consistently, and renders non-empty Markdown', () => {
		const products = [
			makeLegacyProduct({ id: 101, sku: 'A10.XXX', guid: '101', barcode: '4051761201249' }),
			makeLegacyProduct({ id: 102, sku: 'A10.XXX', guid: '102', barcode: '4051761201232' }),
			makeLegacyProduct({ id: 103, sku: 'A10.XXX', guid: '103', barcode: '4051761202772' })
		]
		const variables = [
			makeVariable({ id: 1, productId: 101, sku: '10568' }),
			makeVariable({ id: 2, productId: 102, sku: '10516' }),
			makeVariable({ id: 3, productId: 103, sku: '10559' })
		]
		const dump = makeDump({ products, productVariables: variables })
		const oneC = parseOneC([
			makeOneCRaw({ ID_nom: '10568', VariativeNomenclature: 'A10.XXX', Barcode: '4051761201249' }),
			makeOneCRaw({ ID_nom: '10516', VariativeNomenclature: 'A10.XXX', Barcode: '4051761201232' }),
			makeOneCRaw({ ID_nom: '10559', VariativeNomenclature: 'A10.XXX', Barcode: '4051761202772' })
		])

		const familyResult = reconcileFamilies(dump, oneC)
		const positionResult = reconcileSqlWith1c(dump, oneC)
		const report = buildVariantParityReport(dump, oneC, familyResult, positionResult)

		expect(report.counts.legacyParentProducts).toBe(3)
		expect(report.counts.legacyVariants).toBe(3)
		expect(report.counts.v2PlannedProducts).toBe(1)
		expect(report.counts.v2PlannedVariants).toBe(3)
		expect(report.counts.v2ProductsWithTwoPlusVariants).toBe(1)
		expect(summarizeLegacyVariantMatches(report.legacyVariantMatches).confirmed).toBe(3)

		const markdown = formatVariantParityReportMarkdown(report)
		expect(markdown).toContain('# VIZAJE-NICA V2 — Legacy Variant Parity Report')
		expect(markdown).toContain('## Counts')
		expect(markdown).toContain('## Family diagnostics')
	})

	test('this audit never mutates its inputs and performs no database or network I/O - pure function over already-parsed data', () => {
		const dump = makeDump({ products: [makeLegacyProduct({ id: 1, guid: '1' })] })
		const oneC = parseOneC([makeOneCRaw({ ID_nom: '1' })])
		const before = JSON.stringify(dump)
		const familyResult = reconcileFamilies(dump, oneC)
		const positionResult = reconcileSqlWith1c(dump, oneC)
		buildVariantParityReport(dump, oneC, familyResult, positionResult)
		expect(JSON.stringify(dump)).toBe(before)
	})
})
