import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, test } from 'bun:test'
import { db } from '../src/db/client'
import { externalEntityMappings } from '../src/db/schema/external-entity-mappings'
import { productVariants } from '../src/db/schema/product-variants'
import { runCatalogImport, type CatalogImportInput } from '../src/import/catalog-importer'
import type { LegacyCatalogDump, LegacyProduct, LegacyProductVariable } from '../src/import/parsers/mysql-catalog'
import { parseProductsFeed, type ProductsFeedRecord } from '../src/import/parsers/products-feed'
import { classifyIdNomDuplicates } from '../src/import/reconcile/duplicate-id-nom'
import { reconcileFamilies } from '../src/import/reconcile/family-reconciliation'
import { reconcileLegacyVariantFamilies } from '../src/import/reconcile/legacy-variant-family-reconciliation'
import { reconcileSqlWith1c } from '../src/import/reconcile/sql-1c-reconciliation'
import { computeVariantPlanVerification, summarizeFamilyMemberCounts } from '../src/import/variant-plan-verification'
import { resetDatabase } from './helpers'

/**
 * Sprint 12B.5 verification follow-up (Questions 1, 2, 4, 5). Read-only
 * tests exercising the new `variant-plan-verification.ts` reporting module
 * against a single SYNTHETIC fixture that deliberately mixes all three
 * import passes in one run:
 *
 *  - legacy product 950: 2 products_variable rows, independently confirmed
 *    by Pass 0 (`reconcileLegacyVariantFamilies`) -> 1 product, 2 variants.
 *  - legacy products 951/952/953: share group-code SKU 'B10.FAM', confirmed
 *    by Pass 1 (`reconcileFamilies`, barcode-matched) -> 1 product, 3 variants.
 *  - legacy products 954/955: standalone, each with its own GUID == ID_nom,
 *    confirmed by Pass 2 (`reconcileSqlWith1c`) -> 2 products, 1 variant each.
 *
 * No reconciliation/matching logic is touched - this only verifies the
 * REPORTING built on top of the real, unmodified `runCatalogImport` output.
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

async function buildInput(dump: LegacyCatalogDump, oneCRaw: Record<string, unknown>[]): Promise<CatalogImportInput> {
	const oneCRecords = parseOneC(oneCRaw)
	const positions = reconcileSqlWith1c(dump, oneCRecords)
	const families = reconcileFamilies(dump, oneCRecords)
	const idNomDuplicates = classifyIdNomDuplicates(oneCRaw, 'ID_nom')
	return { dump, oneCRecords, families, positions, idNomDuplicates }
}

function buildMixedPassDump() {
	const products: LegacyProduct[] = [
		makeLegacyProduct({ id: 950, titleRu: 'Pass0 Family' }),
		makeLegacyProduct({ id: 951, sku: 'B10.FAM', barcode: '9510000000001' }),
		makeLegacyProduct({ id: 952, sku: 'B10.FAM', barcode: '9510000000002' }),
		makeLegacyProduct({ id: 953, sku: 'B10.FAM', barcode: '9510000000003' }),
		makeLegacyProduct({ id: 954, titleRu: 'Standalone A', guid: '954101' }),
		makeLegacyProduct({ id: 955, titleRu: 'Standalone B', guid: '955101' })
	]
	const productVariables: LegacyProductVariable[] = [
		makeVariable({ id: 1, productId: 950, sku: '950101' }),
		makeVariable({ id: 2, productId: 950, sku: '950102' })
	]
	const dump = makeDump({ products, productVariables })
	const oneCRaw = [
		makeOneCRaw({ ID_nom: '950101' }),
		makeOneCRaw({ ID_nom: '950102' }),
		makeOneCRaw({ ID_nom: '951101', VariativeNomenclature: 'B10.FAM', Barcode: '9510000000001' }),
		makeOneCRaw({ ID_nom: '951102', VariativeNomenclature: 'B10.FAM', Barcode: '9510000000002' }),
		makeOneCRaw({ ID_nom: '951103', VariativeNomenclature: 'B10.FAM', Barcode: '9510000000003' }),
		makeOneCRaw({ ID_nom: '954101' }),
		makeOneCRaw({ ID_nom: '955101' })
	]
	return { dump, oneCRaw }
}

describe('Sprint 12B.5 verification follow-up: variant-plan-verification reporting (Questions 1, 2, 5)', () => {
	beforeEach(async () => {
		await resetDatabase()
	})

	test('computeVariantPlanVerification reports the combined Pass 0/1/2 plan correctly', async () => {
		const { dump, oneCRaw } = buildMixedPassDump()
		const input = await buildInput(dump, oneCRaw)

		// Sanity-check the premise: all three passes are actually exercised.
		const legacyFamilies = reconcileLegacyVariantFamilies(dump, input.oneCRecords)
		expect(legacyFamilies.summary.confirmedFamilies).toBe(1)
		expect(input.families.summary.confirmedFamilies).toBe(1)

		const result = await db.transaction(tx => runCatalogImport(tx, input, 'write'))
		expect(result.units.filter(u => u.kind === 'legacy_variant_family' && u.action === 'created')).toHaveLength(1)
		expect(result.units.filter(u => u.kind === 'family' && u.action === 'created')).toHaveLength(1)
		expect(result.units.filter(u => u.kind === 'standalone' && u.action === 'created')).toHaveLength(2)

		const report = computeVariantPlanVerification(result.units)
		// Question 1: products with 2+ variants - the Pass 0 family (2) and the Pass 1 family (3), never the 2 standalone singles.
		expect(report.productsWithTwoPlusVariants).toBe(2)
		// Question 5: 1,2 variants -> '1' bucket; 2 variants -> '2-5'; 3 variants -> '2-5'.
		expect(report.variantCountDistribution).toEqual({ '1': 2, '2-5': 2, '6-10': 0, '11+': 0 })
		expect(report.totalPlannedProducts).toBe(4)
		expect(report.totalPlannedVariants).toBe(2 + 3 + 1 + 1)
	})

	test('summarizeFamilyMemberCounts reports per-classification member-count distribution (Question 2)', async () => {
		const { dump, oneCRaw } = buildMixedPassDump()
		const oneCRecords = parseOneC(oneCRaw)
		const result = reconcileLegacyVariantFamilies(dump, oneCRecords)

		const distribution = summarizeFamilyMemberCounts(result)
		expect(distribution.confirmed).toEqual([2])
		expect(distribution.partial).toEqual([])
		expect(distribution.quarantined).toEqual([])
	})

	test('a family with 2 confirmed + 1 unmatched member reports under "partial", with its true confirmed-member count', async () => {
		const parent = makeLegacyProduct({ id: 960 })
		const variables = [
			makeVariable({ id: 10, productId: 960, sku: '960101' }),
			makeVariable({ id: 11, productId: 960, sku: '960102' }),
			makeVariable({ id: 12, productId: 960, sku: 'no-match-sku' })
		]
		const dump = makeDump({ products: [parent], productVariables: variables })
		const oneCRaw = [makeOneCRaw({ ID_nom: '960101' }), makeOneCRaw({ ID_nom: '960102' })]
		const oneCRecords = parseOneC(oneCRaw)

		const result = reconcileLegacyVariantFamilies(dump, oneCRecords)
		expect(result.families.find(f => f.legacyProductId === 960)?.classification).toBe('partial')
		const distribution = summarizeFamilyMemberCounts(result)
		expect(distribution.partial).toEqual([2])
	})
})

describe('Sprint 12B.5 verification follow-up: no ProductVariant duplication via different external mappings (Question 4)', () => {
	beforeEach(async () => {
		await resetDatabase()
	})

	test('every written product_variants row has at most one 1c/nomenclature mapping, and it always points back at that same row', async () => {
		const { dump, oneCRaw } = buildMixedPassDump()
		const input = await buildInput(dump, oneCRaw)
		await db.transaction(tx => runCatalogImport(tx, input, 'write'))

		const variantRows = await db.select().from(productVariants)
		expect(variantRows.length).toBeGreaterThan(0)

		for (const variant of variantRows) {
			const mappings = await db
				.select()
				.from(externalEntityMappings)
				.where(and(eq(externalEntityMappings.sourceSystem, '1c'), eq(externalEntityMappings.entityType, 'nomenclature'), eq(externalEntityMappings.internalId, variant.id)))
			// A variant created purely from a legacy_mysql products_variable row
			// with no independent 1C evidence would have zero - acceptable. More
			// than one would mean this ProductVariant was reachable from two
			// distinct ID_nom values, which is the duplication this question asks about.
			expect(mappings.length, `product_variants row ${variant.id} must map to at most one 1C ID_nom`).toBeLessThanOrEqual(1)
		}

		// The converse of Question 3's invariant: no single 1c/nomenclature
		// externalId maps to more than one internalId either (redundant with
		// the DB-level unique constraint, kept here as an explicit, readable
		// regression guard rather than relying on the constraint alone).
		const allNomenclatureMappings = await db
			.select()
			.from(externalEntityMappings)
			.where(and(eq(externalEntityMappings.sourceSystem, '1c'), eq(externalEntityMappings.entityType, 'nomenclature')))
		const byExternalId = new Map<string, Set<string>>()
		for (const m of allNomenclatureMappings) {
			const set = byExternalId.get(m.externalId) ?? new Set<string>()
			set.add(m.internalId)
			byExternalId.set(m.externalId, set)
		}
		for (const [externalId, internalIds] of byExternalId) {
			expect(internalIds.size, `ID_nom ${externalId} must resolve to exactly one internal id`).toBe(1)
		}
	})
})
