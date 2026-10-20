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

	test('mutable_only: only Price/QuantityBalance differ', () => {
		const a = baseRecord({ Price: 100, QuantityBalance: 5 })
		const b = baseRecord({ Price: 120, QuantityBalance: 0 })
		const result = classifyIdNomDuplicateGroup('1001', [a, b])
		expect(result.classification).toBe('mutable_only')
		expect(result.differingFields.sort()).toEqual(['Price', 'QuantityBalance'])
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

	test('a 3-way group is still classified correctly when all three agree except one mutable field', () => {
		const a = baseRecord({ Price: 100 })
		const b = baseRecord({ Price: 110 })
		const c = baseRecord({ Price: 120 })
		const result = classifyIdNomDuplicateGroup('1001', [a, b, c])
		expect(result.classification).toBe('mutable_only')
		expect(result.recordCount).toBe(3)
	})
})

describe('classifyIdNomDuplicates', () => {
	test('groups by ID_nom, ignores singletons, and tallies by classification', () => {
		const records = [
			baseRecord({ ID_nom: '1001' }), // singleton, excluded
			baseRecord({ ID_nom: '2001', Price: 100 }),
			baseRecord({ ID_nom: '2001', Price: 150 }), // mutable_only pair
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
