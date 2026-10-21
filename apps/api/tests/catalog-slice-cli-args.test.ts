import { describe, expect, test } from 'bun:test'
import { parseIdList, parseSliceCliArgs } from '../src/import/catalog-slice-cli-args'

describe('catalog-slice-import CLI argument parsing', () => {
	test('parseIdList parses a comma-separated list, trimming whitespace', () => {
		expect(parseIdList('1, 2,3')).toEqual([1, 2, 3])
	})

	test('parseIdList rejects a non-integer entry', () => {
		expect(() => parseIdList('1,abc,3')).toThrow()
	})

	test('parseSliceCliArgs recognizes every selection mode and the write/confirm-slice flags', () => {
		const args = parseSliceCliArgs(['--sql=/a.sql', '--products=/b.json', '--legacy-product-ids=1,2', '--write', '--confirm-slice=deadbeef'])
		expect(args.sql).toBe('/a.sql')
		expect(args.products).toBe('/b.json')
		expect(args.legacyProductIds).toEqual([1, 2])
		expect(args.write).toBe(true)
		expect(args.confirmSlice).toBe('deadbeef')
	})

	test('parseSliceCliArgs recognizes --auto and --brand-ids/--legacy-category-ids independently', () => {
		expect(parseSliceCliArgs(['--auto']).auto).toBe(true)
		expect(parseSliceCliArgs(['--brand-ids=5,6']).brandIds).toEqual([5, 6])
		expect(parseSliceCliArgs(['--legacy-category-ids=7']).legacyCategoryIds).toEqual([7])
	})

	test('defaults: no selection mode, no write, no confirm-slice', () => {
		const args = parseSliceCliArgs(['--sql=/a.sql', '--products=/b.json'])
		expect(args.legacyProductIds).toBeNull()
		expect(args.brandIds).toBeNull()
		expect(args.legacyCategoryIds).toBeNull()
		expect(args.auto).toBe(false)
		expect(args.write).toBe(false)
		expect(args.confirmSlice).toBeNull()
	})
})
