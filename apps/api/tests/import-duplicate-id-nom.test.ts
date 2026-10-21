import { describe, expect, test } from 'bun:test'
import { classifyIdNomDuplicateGroup, classifyIdNomDuplicates } from '../src/import/reconcile/duplicate-id-nom'

/** All synthetic - shaped like the real field layout from docs/legacy-audit/vizaje-1c-audit.md, no real values. */
function baseRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		ID_nom: '1001',
		Brand: 'TestBrand',
		Barcode: '1111111111111',
		ColorVar: null,
		ColorVarMD: null,
		VolumeVar: null,
		VariativeNomenclature: null,
		VariativeName: null,
		Price: 100,
		PriceWH: 50,
		QuantityBalance: 5,
		BalMall: 0,
		BalUNIC: 0,
		Sex: null,
		...overrides
	}
}

describe('classifyIdNomDuplicateGroup', () => {
	test('identical: no fields differ at all', () => {
		const a = baseRecord()
		const b = baseRecord()
		const result = classifyIdNomDuplicateGroup('1001', [a, b])
		expect(result.classification).toBe('identical')
		expect(result.differingFields).toEqual([])
	})

	test('conflicting: a non-mutable, non-variant field differs (Brand)', () => {
		const a = baseRecord({ Brand: 'BrandA' })
		const b = baseRecord({ Brand: 'BrandB' })
		const result = classifyIdNomDuplicateGroup('1001', [a, b])
		expect(result.classification).toBe('conflicting')
		expect(result.differingFields).toContain('Brand')
	})

	test('mutable_only: only PriceWH/QuantityBalance (soft mutable fields) differ', () => {
		const a = baseRecord({ PriceWH: 50, QuantityBalance: 5 })
		const b = baseRecord({ PriceWH: 60, QuantityBalance: 0 })
		const result = classifyIdNomDuplicateGroup('1001', [a, b])
		expect(result.classification).toBe('mutable_only')
		expect(result.differingFields.sort()).toEqual(['PriceWH', 'QuantityBalance'])
	})

	test('price_conflict: only Price differs (Sprint 12A.5 Task 6 - a real price disagreement, never folded into mutable_only)', () => {
		const a = baseRecord({ Price: 100 })
		const b = baseRecord({ Price: 150 })
		const result = classifyIdNomDuplicateGroup('1001', [a, b])
		expect(result.classification).toBe('price_conflict')
		expect(result.differingFields).toEqual(['Price'])
	})

	test('price_conflict: only DiscountPrice differs', () => {
		const a = baseRecord({})
		const b = baseRecord({ Price: 100 }) // same Price, but DiscountPrice differs below
		;(a as Record<string, unknown>).DiscountPrice = 0
		;(b as Record<string, unknown>).DiscountPrice = 20
		const result = classifyIdNomDuplicateGroup('1001', [a, b])
		expect(result.classification).toBe('price_conflict')
		expect(result.differingFields).toContain('DiscountPrice')
	})

	test('identical (not price_conflict): DiscountPrice null on one record and 0 on another, same Price - 1C developer confirmed 0 means "no discount", same as null', () => {
		const a = baseRecord({})
		const b = baseRecord({})
		;(a as Record<string, unknown>).DiscountPrice = null
		;(b as Record<string, unknown>).DiscountPrice = 0
		const result = classifyIdNomDuplicateGroup('1001', [a, b])
		expect(result.classification).toBe('identical')
		expect(result.differingFields).toEqual([])
	})

	test('price_conflict still fires when DiscountPrice is a real nonzero value vs null (not the 0-equivalence case)', () => {
		const a = baseRecord({})
		const b = baseRecord({})
		;(a as Record<string, unknown>).DiscountPrice = null
		;(b as Record<string, unknown>).DiscountPrice = 15
		const result = classifyIdNomDuplicateGroup('1001', [a, b])
		expect(result.classification).toBe('price_conflict')
		expect(result.differingFields).toContain('DiscountPrice')
	})

	test('price_conflict takes priority over mutable_only/variant/barcode when Price and other soft fields both differ', () => {
		const a = baseRecord({ Price: 100, QuantityBalance: 5, ColorVar: '396' })
		const b = baseRecord({ Price: 150, QuantityBalance: 0, ColorVar: '253' })
		const result = classifyIdNomDuplicateGroup('1001', [a, b])
		expect(result.classification).toBe('price_conflict')
	})

	test('barcode_only_conflict: only Barcode differs (Sprint 12A.5 Task 1 - distinct from a general conflict, may be a multi-pack/variant barcode)', () => {
		const a = baseRecord({ Barcode: '1111111111111' })
		const b = baseRecord({ Barcode: '2222222222222' })
		const result = classifyIdNomDuplicateGroup('1001', [a, b])
		expect(result.classification).toBe('barcode_only_conflict')
		expect(result.differingFields).toEqual(['Barcode'])
	})

	test('barcode_only_conflict note reflects the Sprint 12A.6 employee confirmation, not an identity-conflict claim', () => {
		const a = baseRecord({ Barcode: '1111111111111' })
		const b = baseRecord({ Barcode: '2222222222222' })
		const result = classifyIdNomDuplicateGroup('1001', [a, b])
		expect(result.note).toContain('confirmed by a VIZAJE-NICA employee')
		expect(result.note).toContain('Not evidence of a different product')
	})

	test('barcode_only_conflict takes priority over variant_or_warehouse/mutable_only when Barcode and those also differ', () => {
		const a = baseRecord({ Barcode: '1111111111111', ColorVar: '396', QuantityBalance: 5 })
		const b = baseRecord({ Barcode: '2222222222222', ColorVar: '253', QuantityBalance: 0 })
		const result = classifyIdNomDuplicateGroup('1001', [a, b])
		expect(result.classification).toBe('barcode_only_conflict')
	})

	test('a true conflicting field (Brand) always wins over price_conflict and barcode_only_conflict', () => {
		const a = baseRecord({ Brand: 'BrandA', Price: 100, Barcode: '1111111111111' })
		const b = baseRecord({ Brand: 'BrandB', Price: 150, Barcode: '2222222222222' })
		const result = classifyIdNomDuplicateGroup('1001', [a, b])
		expect(result.classification).toBe('conflicting')
	})

	test('variant_or_warehouse: only ColorVar differs', () => {
		const a = baseRecord({ ColorVar: '396' })
		const b = baseRecord({ ColorVar: '253' })
		const result = classifyIdNomDuplicateGroup('1001', [a, b])
		expect(result.classification).toBe('variant_or_warehouse')
		expect(result.differingFields).toEqual(['ColorVar'])
	})

	test('variant_or_warehouse: only a Bal* warehouse column differs', () => {
		const a = baseRecord({ BalMall: 5, BalUNIC: 0 })
		const b = baseRecord({ BalMall: 0, BalUNIC: 3 })
		const result = classifyIdNomDuplicateGroup('1001', [a, b])
		expect(result.classification).toBe('variant_or_warehouse')
		expect(result.differingFields.sort()).toEqual(['BalMall', 'BalUNIC'])
	})

	test('conflicting takes priority over mutable/variant when both kinds of fields differ', () => {
		const a = baseRecord({ Price: 100, ColorVar: '396', Brand: 'BrandA' })
		const b = baseRecord({ Price: 120, ColorVar: '253', Brand: 'BrandB' })
		const result = classifyIdNomDuplicateGroup('1001', [a, b])
		expect(result.classification).toBe('conflicting')
		expect(result.differingFields).toContain('Brand')
	})

	test('requires at least 2 records', () => {
		expect(() => classifyIdNomDuplicateGroup('1001', [baseRecord()])).toThrow()
	})

	test('a 3-way group is still classified correctly when all three agree except one soft-mutable field', () => {
		const a = baseRecord({ QuantityBalance: 5 })
		const b = baseRecord({ QuantityBalance: 3 })
		const c = baseRecord({ QuantityBalance: 0 })
		const result = classifyIdNomDuplicateGroup('1001', [a, b, c])
		expect(result.classification).toBe('mutable_only')
		expect(result.recordCount).toBe(3)
	})

	test('a 3-way group with a real Price disagreement is price_conflict, not mutable_only', () => {
		const a = baseRecord({ Price: 100 })
		const b = baseRecord({ Price: 110 })
		const c = baseRecord({ Price: 120 })
		const result = classifyIdNomDuplicateGroup('1001', [a, b, c])
		expect(result.classification).toBe('price_conflict')
		expect(result.recordCount).toBe(3)
	})
})

describe('classifyIdNomDuplicates', () => {
	test('groups by ID_nom, ignores singletons, and tallies by classification', () => {
		const records = [
			baseRecord({ ID_nom: '1001' }), // singleton, excluded
			baseRecord({ ID_nom: '2001', QuantityBalance: 5 }),
			baseRecord({ ID_nom: '2001', QuantityBalance: 0 }), // mutable_only pair
			baseRecord({ ID_nom: '3001', Brand: 'A' }),
			baseRecord({ ID_nom: '3001', Brand: 'B' }) // conflicting pair
		]
		const report = classifyIdNomDuplicates(records)
		expect(report.totalGroups).toBe(2)
		expect(report.byClassification.mutable_only).toBe(1)
		expect(report.byClassification.conflicting).toBe(1)
		expect(report.examples.conflicting).toHaveLength(1)
		expect(report.examples.conflicting[0].idNom).toBe('3001')
	})

	test('tallies price_conflict and barcode_only_conflict groups distinctly from conflicting/mutable_only', () => {
		const records = [
			baseRecord({ ID_nom: '4001', Price: 100 }),
			baseRecord({ ID_nom: '4001', Price: 150 }), // price_conflict pair
			baseRecord({ ID_nom: '5001', Barcode: '1111111111111' }),
			baseRecord({ ID_nom: '5001', Barcode: '2222222222222' }) // barcode_only_conflict pair
		]
		const report = classifyIdNomDuplicates(records)
		expect(report.totalGroups).toBe(2)
		expect(report.byClassification.price_conflict).toBe(1)
		expect(report.byClassification.barcode_only_conflict).toBe(1)
		expect(report.byClassification.conflicting).toBe(0)
	})

	test('excludes records with no ID_nom from grouping entirely', () => {
		const records = [baseRecord({ ID_nom: undefined }), baseRecord({ ID_nom: undefined })]
		const report = classifyIdNomDuplicates(records)
		expect(report.totalGroups).toBe(0)
	})

	test('never includes raw field values in examples, only field names', () => {
		const records = [baseRecord({ ID_nom: '4001', Brand: 'SecretBrandName' }), baseRecord({ ID_nom: '4001', Brand: 'OtherSecretBrand' })]
		const report = classifyIdNomDuplicates(records)
		const serialized = JSON.stringify(report.examples)
		expect(serialized).not.toContain('SecretBrandName')
		expect(serialized).not.toContain('OtherSecretBrand')
		expect(serialized).toContain('Brand')
	})
})
