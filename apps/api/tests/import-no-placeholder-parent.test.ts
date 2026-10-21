import { describe, expect, test } from 'bun:test'
import type { LegacyCatalogDump, LegacyProduct } from '../src/import/parsers/mysql-catalog'
import type { ProductsFeedRecord } from '../src/import/parsers/products-feed'
import { reconcileSqlWith1c } from '../src/import/reconcile/sql-1c-reconciliation'
import { reconcileFamilies } from '../src/import/reconcile/family-reconciliation'

/**
 * Sprint 12B.0 — pins the single most important invariant the legacy
 * forensic audit's §4.4/§11 flagged as a confirmed legacy bug: the legacy
 * importer's `import_variable()` falls back to a numeric placeholder
 * parent id (`product_id = 0` on insert, `product_id = 1` on update) when
 * no real parent is found for a variant's group code. V2's reconciliation
 * tooling must NEVER do this — an unresolved parent must stay unmatched or
 * quarantined, never attached to an arbitrary/placeholder product id.
 *
 * All data synthetic - no field values copied from the real legacy dump or
 * any real 1C export.
 */
function product(overrides: Partial<LegacyProduct> & { id: number }): LegacyProduct {
	return {
		guid: null,
		sku: null,
		titleRu: 'T',
		titleRo: 'T',
		descRu: null,
		descRo: null,
		textRu: null,
		textRo: null,
		uriRu: null,
		uriRo: null,
		price: 100,
		discountPrice: null,
		priceWh: null,
		volume: null,
		onStock: null,
		stock: null,
		isNew: false,
		categoryId: 1,
		brandId: 1,
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

function dump(products: LegacyProduct[]): LegacyCatalogDump {
	return {
		products,
		productVariables: [],
		brands: [],
		categories: [],
		productCategories: [],
		productImgs: [],
		productVariableImgs: [],
		stores: [],
		storeImgs: [],
		productsMore: []
	}
}

function oneC(overrides: Partial<ProductsFeedRecord> & { ID_nom: string }): ProductsFeedRecord {
	return {
		VariativeNomenclature: null,
		VariativeName: null,
		Barcode: null,
		ColorVar: null,
		VolumeVar: null,
		Brand: null,
		Sex: null,
		QuantityBalance: null,
		Price: null,
		PriceWH: null,
		...overrides
	} as ProductsFeedRecord
}

describe('no product_id=0/1-style placeholder parent (legacy audit §4.4/§11)', () => {
	test('reconcileSqlWith1c: a MySQL product with no 1C counterpart at all is reported unmatched, never attached to a placeholder id', () => {
		// A real-looking id that is deliberately neither 0 nor 1 - if the
		// matcher ever substituted a placeholder, this id would not appear
		// anywhere in the result.
		const result = reconcileSqlWith1c(dump([product({ id: 4242 })]), [oneC({ ID_nom: '99999999' })])

		expect(result.summary.unmatched).toBe(1)
		expect(result.summary.confirmed).toBe(0)
		// No result ever claims a match via a fabricated/placeholder legacy product id.
		for (const entry of result.mysqlResults) {
			expect(entry.legacyProductId === 0 || entry.legacyProductId === 1).toBe(false)
		}
	})

	test('reconcileFamilies: a MySQL-side family with no 1C group-code counterpart leaves its members unmatched, never confirmed against a placeholder', () => {
		const result = reconcileFamilies(
			{
				products: [
					product({ id: 7001, sku: 'Z99.ORPHAN' }),
					product({ id: 7002, sku: 'Z99.ORPHAN' })
				]
			},
			[oneC({ ID_nom: '1', VariativeNomenclature: 'A10.UNRELATED' })]
		)

		const orphanFamily = result.families.find(f => f.mysqlOriginalCodes.includes('Z99.ORPHAN'))
		expect(orphanFamily?.outcome).toBe('unmatched_mysql_family')
		expect(orphanFamily?.mysqlMemberIds.sort()).toEqual([7001, 7002])

		const orphanPositions = result.positions.filter(p => p.mysqlProductId === 7001 || p.mysqlProductId === 7002)
		expect(orphanPositions).toHaveLength(2)
		for (const position of orphanPositions) {
			expect(position.outcome).toBe('unmatched_position')
			// The position's own real MySQL product id is preserved - never
			// rewritten to a placeholder, and never silently attached to the
			// unrelated 1C family that happens to exist in this fixture.
			expect(position.mysqlProductId === 0 || position.mysqlProductId === 1).toBe(false)
			expect([7001, 7002]).toContain(position.mysqlProductId)
			expect(position.matchedOneCIdNoms).toEqual([])
		}
	})

	test('reconcileFamilies: an already-quarantined position (e.g. the real 463-variant product_id=1 cluster) stays quarantine, never promoted to confirmed by a coincidental family match', () => {
		const priorQuarantine = new Map([[8001, ['duplicate_guid' as const]]])

		const result = reconcileFamilies(
			{ products: [product({ id: 8001, sku: 'A55.GROUP', guid: '555555' })] },
			[oneC({ ID_nom: '555555', VariativeNomenclature: 'A55.GROUP' })],
			priorQuarantine
		)

		const position = result.positions.find(p => p.mysqlProductId === 8001)
		expect(position?.outcome).toBe('quarantine')
		expect(position?.priorQuarantineReasonCodes).toEqual(['duplicate_guid'])
	})
})
