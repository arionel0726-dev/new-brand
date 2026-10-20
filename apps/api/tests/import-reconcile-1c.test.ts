import { describe, expect, test } from 'bun:test'
import type { LegacyCatalogDump, LegacyProduct } from '../src/import/parsers/mysql-catalog'
import type { ProductsFeedRecord } from '../src/import/parsers/products-feed'
import type { QuarantineReasonCode } from '../src/import/dry-run-catalog'
import { quarantineMapFromCatalogDryRun, reconcileSqlWith1c } from '../src/import/reconcile/sql-1c-reconciliation'

/** All synthetic - no field values are copied from the real legacy dump or any real 1C export. */
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

describe('reconcileSqlWith1c', () => {
	test('confirmed match via GUID == ID_nom (the primary identity link per workapp-1c-observed-contract.md)', () => {
		const result = reconcileSqlWith1c(dump([product({ id: 1, guid: '10568' })]), [oneC({ ID_nom: '10568' })])

		expect(result.mysqlResults).toHaveLength(1)
		expect(result.mysqlResults[0].outcome).toBe('confirmed')
		expect(result.mysqlResults[0].basis).toEqual([{ key: 'guid_id_nom', mysqlValue: '10568', oneCValue: '10568' }])
		expect(result.mysqlResults[0].matchedOneCIdNoms).toEqual(['10568'])
		expect(result.summary.confirmed).toBe(1)
		expect(result.summary.byMatchKeyCandidates.guid_id_nom).toBe(1)
		expect(result.summary.byMatchKeyConfirmedEntities.guid_id_nom).toBe(1)
		expect(result.mysqlResults[0].confirmedKeys).toEqual(['guid_id_nom'])
	})

	test('confirmed match via barcode when GUID is absent', () => {
		const result = reconcileSqlWith1c(dump([product({ id: 1, guid: null, barcode: '4051761201249' })]), [
			oneC({ ID_nom: '999', Barcode: '4051761201249' })
		])

		expect(result.mysqlResults[0].outcome).toBe('confirmed')
		expect(result.mysqlResults[0].basis[0].key).toBe('barcode')
		expect(result.summary.byMatchKeyCandidates.barcode).toBe(1)
		expect(result.summary.byMatchKeyConfirmedEntities.barcode).toBe(1)
	})

	test('ambiguous when two 1C records share the same ID_nom as one MySQL GUID (duplicate 1C input)', () => {
		const result = reconcileSqlWith1c(dump([product({ id: 1, guid: '10568' })]), [
			oneC({ ID_nom: '10568', Barcode: 'a' }),
			oneC({ ID_nom: '10568', Barcode: 'b' })
		])

		expect(result.mysqlResults[0].outcome).toBe('ambiguous')
		expect(result.summary.ambiguous).toBe(1)
	})

	test('ambiguous when GUID and barcode point at two different 1C records (conflicting signals)', () => {
		const result = reconcileSqlWith1c(dump([product({ id: 1, guid: '10568', barcode: 'bc-1' })]), [
			oneC({ ID_nom: '10568', Barcode: 'bc-2' }),
			oneC({ ID_nom: '99999', Barcode: 'bc-1' })
		])

		expect(result.mysqlResults[0].outcome).toBe('ambiguous')
		expect(result.mysqlResults[0].matchedOneCIdNoms.sort()).toEqual(['10568', '99999'])
	})

	test('unmatched when no candidate exists on any key', () => {
		const result = reconcileSqlWith1c(dump([product({ id: 1, guid: '10568', barcode: 'bc-1' })]), [
			oneC({ ID_nom: '1', Barcode: 'bc-2' })
		])

		expect(result.mysqlResults[0].outcome).toBe('unmatched')
		expect(result.summary.unmatched).toBe(1)
		expect(result.mysqlResults[0].reasoning).toContain('no 1C record found')
	})

	test('unmatched when the MySQL product has no GUID, barcode, or group-code SKU at all', () => {
		const result = reconcileSqlWith1c(dump([product({ id: 1 })]), [oneC({ ID_nom: '1' })])

		expect(result.mysqlResults[0].outcome).toBe('unmatched')
		expect(result.mysqlResults[0].reasoning).toContain('no GUID, barcode, or group-code SKU available')
	})

	test('a product already quarantined by the Sprint 12A.2 catalog dry-run stays quarantined through reconciliation, even with a confirmed-quality 1C match', () => {
		const priorQuarantine = new Map<number, QuarantineReasonCode[]>([[1, ['duplicate_guid']]])
		const result = reconcileSqlWith1c(
			dump([product({ id: 1, guid: '10568' })]),
			[oneC({ ID_nom: '10568' })],
			priorQuarantine
		)

		expect(result.mysqlResults[0].outcome).toBe('quarantine')
		expect(result.mysqlResults[0].priorQuarantineReasonCodes).toEqual(['duplicate_guid'])
		// The 1C match evidence is still attached for a human reviewer...
		expect(result.mysqlResults[0].basis).toEqual([{ key: 'guid_id_nom', mysqlValue: '10568', oneCValue: '10568' }])
		// ...it just never overrides the quarantine outcome.
		expect(result.summary.quarantine).toBe(1)
		expect(result.summary.confirmed).toBe(0)
	})

	test('quarantineMapFromCatalogDryRun only carries products with at least one reason code', () => {
		const map = quarantineMapFromCatalogDryRun([
			{ legacyProductId: 1, quarantineReasonCodes: ['duplicate_sku'] },
			{ legacyProductId: 2, quarantineReasonCodes: [] }
		])
		expect(map.get(1)).toEqual(['duplicate_sku'])
		expect(map.has(2)).toBe(false)
	})

	test('VariativeNomenclature group-code match: a 1:1 group resolves to a confirmed match via grouping', () => {
		const result = reconcileSqlWith1c(dump([product({ id: 1, guid: null, barcode: null, sku: 'A10.XXX' })]), [
			oneC({ ID_nom: '55', VariativeNomenclature: 'A10.XXX' })
		])

		expect(result.mysqlResults[0].outcome).toBe('confirmed')
		expect(result.mysqlResults[0].basis[0]).toEqual({
			key: 'variative_nomenclature_group',
			mysqlValue: 'A10.XXX',
			oneCValue: '55'
		})
	})

	test('VariativeNomenclature group-code match does NOT fire when the MySQL-side group has more than one sibling (not a 1:1 pairing)', () => {
		const result = reconcileSqlWith1c(
			dump([
				product({ id: 1, guid: null, barcode: null, sku: 'A10.XXX' }),
				product({ id: 2, guid: null, barcode: null, sku: 'A10.XXX' })
			]),
			[oneC({ ID_nom: '55', VariativeNomenclature: 'A10.XXX' })]
		)

		for (const r of result.mysqlResults) {
			expect(r.basis.some(b => b.key === 'variative_nomenclature_group')).toBe(false)
			expect(r.outcome).toBe('unmatched')
		}
	})

	test('every unmatched 1C record (no MySQL product matched its ID_nom) is surfaced in the reverse direction', () => {
		const result = reconcileSqlWith1c(dump([product({ id: 1, guid: '10568' })]), [
			oneC({ ID_nom: '10568' }),
			oneC({ ID_nom: '99999', VariativeNomenclature: 'G1', Barcode: 'bc-9' })
		])

		expect(result.unmatchedOneCRecords).toHaveLength(1)
		expect(result.unmatchedOneCRecords[0]).toEqual({
			idNom: '99999',
			variativeNomenclature: 'G1',
			barcode: 'bc-9',
			reasoning: 'no MySQL product matched this ID_nom on GUID, barcode, or group-code'
		})
		expect(result.summary.unmatchedOneCRecordCount).toBe(1)
	})

	test('basis and reasoning are always populated, never left empty on a non-trivial result', () => {
		const result = reconcileSqlWith1c(dump([product({ id: 1, guid: '10568', barcode: 'bc-1' })]), [
			oneC({ ID_nom: '10568', Barcode: 'bc-1' })
		])

		const r = result.mysqlResults[0]
		expect(r.basis.length).toBeGreaterThan(0)
		expect(r.reasoning.length).toBeGreaterThan(0)
	})

	test('summary counts and example buckets stay consistent across a small mixed batch', () => {
		const priorQuarantine = new Map<number, QuarantineReasonCode[]>([[3, ['duplicate_sku']]])
		const result = reconcileSqlWith1c(
			dump([
				product({ id: 1, guid: '1' }), // confirmed
				product({ id: 2, guid: '2' }), // unmatched (no 1C record for guid 2)
				product({ id: 3, guid: '3' }) // quarantined regardless of match
			]),
			[oneC({ ID_nom: '1' }), oneC({ ID_nom: '3' })],
			priorQuarantine
		)

		expect(result.summary.totalMysqlProducts).toBe(3)
		expect(result.summary.confirmed).toBe(1)
		expect(result.summary.unmatched).toBe(1)
		expect(result.summary.quarantine).toBe(1)
		expect(result.summary.examples.confirmed[0].legacyProductId).toBe(1)
		expect(result.summary.examples.quarantine[0].legacyProductId).toBe(3)
	})

	// Sprint 12A.5 Task 3: the real reconciliation run reported ZERO
	// variative_nomenclature_group matches despite 1536 distinct 1C
	// VariativeNomenclature values observed. Code review found the Map-key
	// join between the MySQL-side group-code index and the 1C-side
	// VariativeNomenclature index was case-sensitive - this test pins the fix.
	test('VariativeNomenclature group-code match fires despite a case/whitespace-only difference between the MySQL SKU and the 1C VariativeNomenclature', () => {
		const result = reconcileSqlWith1c(dump([product({ id: 1, guid: null, barcode: null, sku: 'a10.xxx' })]), [
			oneC({ ID_nom: '55', VariativeNomenclature: ' A10.XXX ' })
		])

		expect(result.mysqlResults[0].outcome).toBe('confirmed')
		expect(result.mysqlResults[0].basis[0]).toEqual({
			key: 'variative_nomenclature_group',
			// The original, un-normalized values are preserved for human review.
			mysqlValue: 'a10.xxx',
			oneCValue: '55'
		})
	})

	// Sprint 12A.5 Task 2
	describe('byMatchKeyCandidates vs byMatchKeyConfirmedEntities', () => {
		test('a candidate-only signal (duplicate 1C barcode, still ambiguous) counts in Candidates but not in ConfirmedEntities', () => {
			const result = reconcileSqlWith1c(dump([product({ id: 1, guid: null, barcode: 'bc-1' })]), [
				oneC({ ID_nom: '1', Barcode: 'bc-1' }),
				oneC({ ID_nom: '2', Barcode: 'bc-1' })
			])

			expect(result.mysqlResults[0].outcome).toBe('ambiguous')
			// Two candidate signals contributed (one basis entry per matching 1C record).
			expect(result.summary.byMatchKeyCandidates.barcode).toBe(2)
			// Never confirmed, so it must not count toward ConfirmedEntities.
			expect(result.summary.byMatchKeyConfirmedEntities.barcode).toBe(0)
		})

		test('a confirmed match where two keys agree counts once under each key in ConfirmedEntities', () => {
			const result = reconcileSqlWith1c(dump([product({ id: 1, guid: '1', barcode: 'bc-1' })]), [
				oneC({ ID_nom: '1', Barcode: 'bc-1' })
			])

			expect(result.mysqlResults[0].outcome).toBe('confirmed')
			expect(result.mysqlResults[0].confirmedKeys?.sort()).toEqual(['barcode', 'guid_id_nom'])
			expect(result.summary.byMatchKeyConfirmedEntities.guid_id_nom).toBe(1)
			expect(result.summary.byMatchKeyConfirmedEntities.barcode).toBe(1)
		})
	})

	// Sprint 12A.5 Task 4
	describe('ambiguityReasonCode', () => {
		test('conflicting_candidates: GUID and barcode point at two different 1C records', () => {
			const result = reconcileSqlWith1c(dump([product({ id: 1, guid: '1', barcode: 'bc-2' })]), [
				oneC({ ID_nom: '1' }),
				oneC({ ID_nom: '2', Barcode: 'bc-2' })
			])

			expect(result.mysqlResults[0].outcome).toBe('ambiguous')
			expect(result.mysqlResults[0].ambiguityReasonCode).toBe('conflicting_candidates')
			expect(result.summary.ambiguousByReasonCode.conflicting_candidates).toBe(1)
			expect(result.summary.ambiguousByReasonCode.duplicate_1c_records_on_single_key).toBe(0)
		})

		test('duplicate_1c_records_on_single_key: one candidate ID_nom, but that key hit more than one 1C record', () => {
			const result = reconcileSqlWith1c(dump([product({ id: 1, guid: '1' })]), [
				oneC({ ID_nom: '1' }),
				oneC({ ID_nom: '1' })
			])

			expect(result.mysqlResults[0].outcome).toBe('ambiguous')
			expect(result.mysqlResults[0].ambiguityReasonCode).toBe('duplicate_1c_records_on_single_key')
			expect(result.summary.ambiguousByReasonCode.duplicate_1c_records_on_single_key).toBe(1)
		})
	})

	// Sprint 12A.5 Task 5
	describe('possiblyDiscontinued evidence', () => {
		test('unmatched AND hidden in MySQL (isShown === false) is flagged possiblyDiscontinued', () => {
			const result = reconcileSqlWith1c(dump([product({ id: 1, guid: '1', isShown: false })]), [])

			expect(result.mysqlResults[0].outcome).toBe('unmatched')
			expect(result.mysqlResults[0].possiblyDiscontinued).toBe(true)
			expect(result.summary.possiblyDiscontinuedCount).toBe(1)
		})

		test('unmatched but still shown (isShown === true) is NOT assumed discontinued - lands in the neutral bucket', () => {
			const result = reconcileSqlWith1c(dump([product({ id: 1, guid: '1', isShown: true })]), [])

			expect(result.mysqlResults[0].outcome).toBe('unmatched')
			expect(result.mysqlResults[0].possiblyDiscontinued).toBe(false)
			expect(result.summary.possiblyDiscontinuedCount).toBe(0)
		})

		test('possiblyDiscontinued is false for a confirmed match even if the product happens to be hidden (the raw attempt was never "unmatched")', () => {
			const result = reconcileSqlWith1c(dump([product({ id: 1, guid: '1', isShown: false })]), [oneC({ ID_nom: '1' })])

			expect(result.mysqlResults[0].outcome).toBe('confirmed')
			expect(result.mysqlResults[0].possiblyDiscontinued).toBe(false)
		})

		test('a prior quarantine never erases possiblyDiscontinued evidence from the raw match attempt - it stays attached, same as reasoning/basis', () => {
			const priorQuarantine = new Map<number, QuarantineReasonCode[]>([[2, ['duplicate_sku']]])
			const result = reconcileSqlWith1c(
				dump([product({ id: 2, guid: '9', isShown: false })]), // raw attempt: unmatched + hidden, then overridden to quarantine
				[oneC({ ID_nom: '1' })],
				priorQuarantine
			)

			expect(result.mysqlResults[0].outcome).toBe('quarantine')
			// The raw match attempt (unmatched + hidden) is preserved as context for whoever resolves the quarantine.
			expect(result.mysqlResults[0].possiblyDiscontinued).toBe(true)
			// The aggregate counts the same raw-attempt evidence, consistent with byMatchKeyCandidates/ambiguousByReasonCode.
			expect(result.summary.possiblyDiscontinuedCount).toBe(1)
		})
	})

	// Sprint 12A.5 Task 7: the new diagnostic fields must never leak raw row data.
	test('the new Sprint 12A.5 diagnostic fields are enums/booleans/ids only - never raw field values', () => {
		const result = reconcileSqlWith1c(dump([product({ id: 1, guid: '1', isShown: false })]), [])
		const serialized = JSON.stringify(result.summary)
		// Every value in the summary must be a number, a known enum string, or structural - spot-check no accidental string leakage beyond known enum keys.
		expect(serialized).not.toContain('titleRu')
		expect(serialized).not.toContain('descRu')
	})
})
