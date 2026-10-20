import { describe, expect, test } from 'bun:test'
import type { LegacyProduct } from '../src/import/parsers/mysql-catalog'
import type { ProductsFeedRecord } from '../src/import/parsers/products-feed'
import type { QuarantineReasonCode } from '../src/import/dry-run-catalog'
import { reconcileFamilies } from '../src/import/reconcile/family-reconciliation'

/** All synthetic - no field values are copied from the real legacy dump or any real 1C export. Mirrors tests/import-reconcile-1c.test.ts's fixture style. */
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

describe('reconcileFamilies: multi-variant families (Requirement 3)', () => {
	test('a 3-member family on both sides, fully corroborated by GUID, is confirmed_family with 3 confirmed_position entries', () => {
		const mysql = [
			product({ id: 1, sku: 'A10.XXX', guid: '10568' }),
			product({ id: 2, sku: 'A10.XXX', guid: '10516' }),
			product({ id: 3, sku: 'A10.XXX', guid: '10559' })
		]
		const oneCRecords = [
			oneC({ ID_nom: '10568', VariativeNomenclature: 'A10.XXX' }),
			oneC({ ID_nom: '10516', VariativeNomenclature: 'A10.XXX' }),
			oneC({ ID_nom: '10559', VariativeNomenclature: 'A10.XXX' })
		]

		const result = reconcileFamilies({ products: mysql }, oneCRecords)

		expect(result.summary.totalMysqlFamilies).toBe(1)
		expect(result.summary.totalOneCFamilies).toBe(1)
		expect(result.summary.confirmedFamilies).toBe(1)
		expect(result.summary.collisionRiskFamilies).toBe(0)
		expect(result.summary.confirmedPositions).toBe(3)
		expect(result.summary.ambiguousPositions).toBe(0)
		expect(result.summary.unmatchedPositions).toBe(0)

		const family = result.families[0]
		expect(family.outcome).toBe('confirmed_family')
		expect(family.mysqlMemberIds.sort()).toEqual([1, 2, 3])
		expect(family.oneCMemberIdNoms.sort()).toEqual(['10516', '10559', '10568'])
		expect(family.corroboration).toHaveLength(3)
	})

	test('a multi-member family with no corroborating GUID/barcode evidence is ambiguous_family, never silently confirmed (Requirement 5)', () => {
		const mysql = [product({ id: 1, sku: 'B20.XXX' }), product({ id: 2, sku: 'B20.XXX' })]
		const oneCRecords = [
			oneC({ ID_nom: '100', VariativeNomenclature: 'B20.XXX' }),
			oneC({ ID_nom: '101', VariativeNomenclature: 'B20.XXX' })
		]

		const result = reconcileFamilies({ products: mysql }, oneCRecords)

		expect(result.families[0].outcome).toBe('ambiguous_family')
		expect(result.families[0].collisionRisk).toBe(true)
		expect(result.families[0].corroboration).toHaveLength(0)
		expect(result.summary.confirmedFamilies).toBe(0)
		expect(result.summary.ambiguousFamilies).toBe(1)
	})
})

describe('reconcileFamilies: case normalization (Sprint 12A.5 fix, reused here)', () => {
	test('a family code differing only by case between MySQL and 1C sides still matches as one family', () => {
		const mysql = [product({ id: 1, sku: 'a10.xxx', guid: '10568' })]
		const oneCRecords = [oneC({ ID_nom: '10568', VariativeNomenclature: 'A10.XXX' })]

		const result = reconcileFamilies({ products: mysql }, oneCRecords)

		expect(result.families).toHaveLength(1)
		expect(result.families[0].outcome).toBe('confirmed_family')
		// Original, un-normalized values are preserved for human review.
		expect(result.families[0].mysqlOriginalCodes).toEqual(['a10.xxx'])
		expect(result.families[0].oneCOriginalCodes).toEqual(['A10.XXX'])
	})
})

describe('reconcileFamilies: barcode aliases (Requirement 8 - barcode as a set per position)', () => {
	test('one ID_nom position with 2 barcode-row aliases still resolves a MySQL member matching either barcode', () => {
		const mysql = [
			product({ id: 1, sku: 'C30.XXX', barcode: 'BC-ALIAS-2' }),
			product({ id: 2, sku: 'C30.XXX', guid: '202' })
		]
		const oneCRecords = [
			// Same ID_nom "201" appears twice, once per barcode alias - a real,
			// employee-confirmed pattern (Sprint 12A.6 confirmation #1), never
			// treated as "the family only has one real 1C member".
			oneC({ ID_nom: '201', VariativeNomenclature: 'C30.XXX', Barcode: 'BC-ALIAS-1' }),
			oneC({ ID_nom: '201', VariativeNomenclature: 'C30.XXX', Barcode: 'BC-ALIAS-2' }),
			oneC({ ID_nom: '202', VariativeNomenclature: 'C30.XXX' })
		]

		const result = reconcileFamilies({ products: mysql }, oneCRecords)

		const family = result.families[0]
		expect(family.outcome).toBe('confirmed_family')
		expect(family.oneCMemberIdNoms.sort()).toEqual(['201', '201', '202'])

		const position1 = result.positions.find(p => p.mysqlProductId === 1)
		expect(position1?.outcome).toBe('confirmed_position')
		expect(position1?.matchedOneCIdNoms).toEqual(['201'])
		expect(position1?.basis).toEqual(['barcode'])

		const position2 = result.positions.find(p => p.mysqlProductId === 2)
		expect(position2?.outcome).toBe('confirmed_position')
		expect(position2?.matchedOneCIdNoms).toEqual(['202'])
	})
})

describe('reconcileFamilies: duplicated group codes / collision risk (Requirement 5)', () => {
	test('two clearly-unrelated synthetic families sharing a normalized group-code string are flagged as a collision risk, never silently merged', () => {
		// Two unrelated product lines happen to both use the literal code
		// "D40.XXX" - MySQL member 1 and 1C ID_nom "301" are really the same
		// item (GUID corroborates), but MySQL member 2's GUID points to
		// ID_nom "999", which belongs to NO family at all - a contradiction
		// that must surface as collisionRisk, not get swept into a false
		// "confirmed_family".
		const mysql = [product({ id: 1, sku: 'D40.XXX', guid: '301' }), product({ id: 2, sku: 'D40.XXX', guid: '999' })]
		const oneCRecords = [
			oneC({ ID_nom: '301', VariativeNomenclature: 'D40.XXX' }),
			oneC({ ID_nom: '302', VariativeNomenclature: 'D40.XXX' }),
			// Unrelated record, no VariativeNomenclature at all - member 2's
			// own GUID evidence points here, outside the "D40.XXX" family.
			oneC({ ID_nom: '999' })
		]

		const result = reconcileFamilies({ products: mysql }, oneCRecords)

		const family = result.families[0]
		expect(family.outcome).toBe('ambiguous_family')
		expect(family.collisionRisk).toBe(true)
		expect(family.contradictions).toHaveLength(1)
		expect(family.contradictions[0]).toMatchObject({ mysqlProductId: 2, oneCIdNom: '999', key: 'guid_id_nom' })
		// Member 1's genuine corroborating evidence is still reported, even
		// though the family as a whole is flagged ambiguous/collision-risk.
		expect(family.corroboration).toHaveLength(1)

		const position1 = result.positions.find(p => p.mysqlProductId === 1)
		expect(position1?.outcome).toBe('confirmed_position')

		const position2 = result.positions.find(p => p.mysqlProductId === 2)
		expect(position2?.outcome).toBe('ambiguous_position')
		expect(position2?.reasoning).toContain('outside the matched family')
	})

	test('an ID_nom seen under two distinct family codes in the 1C feed itself is reported as a conflicting membership, never auto-assigned', () => {
		const mysql: LegacyProduct[] = []
		const oneCRecords = [
			oneC({ ID_nom: '401', VariativeNomenclature: 'E50.XXX' }),
			oneC({ ID_nom: '401', VariativeNomenclature: 'E60.YYY' })
		]

		const result = reconcileFamilies({ products: mysql }, oneCRecords)

		expect(result.conflictingMemberships).toHaveLength(1)
		expect(result.conflictingMemberships[0].idNom).toBe('401')
		expect(result.conflictingMemberships[0].normalizedCodes.sort()).toEqual(['E50.XXX', 'E60.YYY'])
		expect(result.summary.conflictingMembershipCount).toBe(1)
	})
})

describe('reconcileFamilies: orphan members (Requirement 10)', () => {
	test('a MySQL family with no 1C counterpart at all stays unmatched_mysql_family, members unmatched_position', () => {
		const mysql = [product({ id: 1, sku: 'F70.XXX' })]
		const result = reconcileFamilies({ products: mysql }, [])

		expect(result.families[0].outcome).toBe('unmatched_mysql_family')
		expect(result.positions[0].outcome).toBe('unmatched_position')
		expect(result.summary.unmatchedMysqlFamilies).toBe(1)
		expect(result.summary.unmatchedPositions).toBe(1)
	})

	test('a 1C family with no MySQL counterpart at all stays unmatched_1c_family and contributes no positions', () => {
		const oneCRecords = [oneC({ ID_nom: '501', VariativeNomenclature: 'G80.XXX' })]
		const result = reconcileFamilies({ products: [] }, oneCRecords)

		expect(result.families[0].outcome).toBe('unmatched_1c_family')
		expect(result.positions).toHaveLength(0)
		expect(result.summary.unmatchedOneCFamilies).toBe(1)
	})

	test('a known orphan-variant product (no sku group code at all) never enters a family bucket and is excluded from this report entirely', () => {
		// Mirrors the real Sprint 12A.2 orphan-variant shape: no group-code
		// SKU to key a family on. Family-level reconciliation has nothing to
		// say about it either way - it is neither confirmed, ambiguous, nor
		// "unmatched_mysql_family"; it simply never appears here, exactly as
		// the whole-dataset `reconcileSqlWith1c`/quarantine pipeline already
		// handles it independently.
		const mysql = [product({ id: 999, sku: null })]
		const result = reconcileFamilies({ products: mysql }, [])

		expect(result.families).toHaveLength(0)
		expect(result.positions).toHaveLength(0)
	})
})

describe('reconcileFamilies: quarantine is never cleared by family evidence (Requirement 6)', () => {
	test('a quarantined MySQL product stays quarantine even with a perfect within-family GUID match', () => {
		const mysql = [product({ id: 1, sku: 'H90.XXX', guid: '601' })]
		const oneCRecords = [oneC({ ID_nom: '601', VariativeNomenclature: 'H90.XXX' })]
		const priorQuarantine = new Map<number, QuarantineReasonCode[]>([[1, ['duplicate_guid']]])

		const result = reconcileFamilies({ products: mysql }, oneCRecords, priorQuarantine)

		expect(result.positions[0].outcome).toBe('quarantine')
		expect(result.positions[0].priorQuarantineReasonCodes).toEqual(['duplicate_guid'])
		expect(result.summary.quarantinedPositions).toBe(1)
		expect(result.summary.confirmedPositions).toBe(0)
		// The family itself is still reported as confirmed (it's useful
		// evidence for whoever resolves the quarantine) - only the
		// *position* outcome is forced to quarantine, exactly like
		// reconcileSqlWith1c's own priorQuarantine handling.
		expect(result.families[0].outcome).toBe('confirmed_family')
	})

	test('a quarantined product in an unmatched_mysql_family also reports quarantine, not unmatched_position', () => {
		const mysql = [product({ id: 2, sku: 'I00.XXX' })]
		const priorQuarantine = new Map<number, QuarantineReasonCode[]>([[2, ['duplicate_guid']]])

		const result = reconcileFamilies({ products: mysql }, [], priorQuarantine)

		expect(result.positions[0].outcome).toBe('quarantine')
	})
})

describe('reconcileFamilies: price-conflict and duplicate-ID_nom preservation is untouched (Requirement 9)', () => {
	test('a duplicate-ID_nom 1C record pair with disagreeing Price is still visible via matchedOneCIdNoms/basis, never silently picked or dropped', () => {
		const mysql = [product({ id: 1, sku: 'J10.XXX', guid: '701' })]
		const oneCRecords = [
			oneC({ ID_nom: '701', VariativeNomenclature: 'J10.XXX', Price: 1000 }),
			oneC({ ID_nom: '701', VariativeNomenclature: 'J10.XXX', Price: 2000 })
		]

		const result = reconcileFamilies({ products: mysql }, oneCRecords)

		// Family-level reconciliation does not interpret Price at all - this
		// module never reads or compares it, so a price disagreement between
		// two rows sharing one ID_nom passes through untouched, exactly as
		// `classifyIdNomDuplicates` (a separate module) already classifies it
		// as its own `price_conflict` tier.
		expect(result.families[0].oneCMemberIdNoms).toEqual(['701', '701'])
		const position = result.positions[0]
		expect(position.outcome).toBe('confirmed_position')
		expect(position.matchedOneCIdNoms).toEqual(['701'])
	})
})
