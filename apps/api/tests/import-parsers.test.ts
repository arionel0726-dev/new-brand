import { describe, expect, test } from 'bun:test'
import { normalizeBarcode } from '../src/import/barcode'
import { parseMajorUnitToBani } from '../src/import/money'
import { parseJobvnSeoFeed } from '../src/import/parsers/jobvn-seo-feed'
import { parsePricevnFeed } from '../src/import/parsers/pricevn-feed'
import { parseProductsFeed } from '../src/import/parsers/products-feed'

describe('parseMajorUnitToBani (decimal-safe money parsing)', () => {
	test('parses a plain decimal string', () => {
		const result = parseMajorUnitToBani('199.99')
		expect(result).toEqual({ ok: true, bani: 19999 })
	})

	test('parses a JSON number without float drift', () => {
		// 19.99 * 100 in naive floating point can land on 1998.9999999999998 -
		// this must still come out to exactly 1999.
		const result = parseMajorUnitToBani(19.99)
		expect(result).toEqual({ ok: true, bani: 1999 })
	})

	test('accepts zero', () => {
		expect(parseMajorUnitToBani(0)).toEqual({ ok: true, bani: 0 })
		expect(parseMajorUnitToBani('0')).toEqual({ ok: true, bani: 0 })
		expect(parseMajorUnitToBani('0.00')).toEqual({ ok: true, bani: 0 })
	})

	test('pads a single fractional digit', () => {
		expect(parseMajorUnitToBani('10.5')).toEqual({ ok: true, bani: 1050 })
	})

	test('handles a whole number with no fractional part', () => {
		expect(parseMajorUnitToBani('100')).toEqual({ ok: true, bani: 10000 })
	})

	test('rejects a negative price', () => {
		const result = parseMajorUnitToBani('-5.00')
		expect(result.ok).toBe(false)
	})

	test('rejects more than 2 fractional digits rather than guessing how to round', () => {
		const result = parseMajorUnitToBani('19.999')
		expect(result.ok).toBe(false)
	})

	test('rejects a non-numeric string', () => {
		expect(parseMajorUnitToBani('not a price').ok).toBe(false)
		expect(parseMajorUnitToBani('1e2').ok).toBe(false)
	})

	test('rejects missing/empty values', () => {
		expect(parseMajorUnitToBani(null).ok).toBe(false)
		expect(parseMajorUnitToBani(undefined).ok).toBe(false)
		expect(parseMajorUnitToBani('').ok).toBe(false)
		expect(parseMajorUnitToBani('   ').ok).toBe(false)
	})
})

describe('normalizeBarcode', () => {
	test('preserves leading zeros', () => {
		expect(normalizeBarcode('0012345678905')).toBe('0012345678905')
	})

	test('trims whitespace', () => {
		expect(normalizeBarcode('  0012345678905  ')).toBe('0012345678905')
	})

	test('treats blank/empty as absent', () => {
		expect(normalizeBarcode('')).toBeNull()
		expect(normalizeBarcode('   ')).toBeNull()
		expect(normalizeBarcode(null)).toBeNull()
		expect(normalizeBarcode(undefined)).toBeNull()
	})
})

describe('parseProductsFeed', () => {
	test('parses valid grouped and standalone records', () => {
		const result = parseProductsFeed([
			{ ID_nom: 10568, VariativeNomenclature: 'A10.XXX', VariativeName: 'Lipstick A10', Barcode: '0012345678905' },
			{ ID_nom: 20001, Barcode: '0099988877701' }
		])
		expect(result.validRecords).toHaveLength(2)
		expect(result.rejected).toHaveLength(0)
	})

	test('rejects a record with an unexpected/malformed ID_nom type', () => {
		const result = parseProductsFeed([{ ID_nom: 'not-a-number' }, { ID_nom: 10.5 }, { ID_nom: '' }])
		expect(result.validRecords).toHaveLength(0)
		expect(result.rejected).toHaveLength(3)
	})

	test('rejects an entirely unexpected record structure (missing ID_nom)', () => {
		const result = parseProductsFeed([{ someOtherField: 'x' }])
		expect(result.rejected).toHaveLength(1)
	})

	test('detects duplicate ID_nom within the same feed', () => {
		const result = parseProductsFeed([{ ID_nom: 10568 }, { ID_nom: 10568 }, { ID_nom: 999 }])
		expect(result.validRecords).toHaveLength(3)
		expect(result.duplicateKeys).toEqual([{ key: '10568', recordIndexes: [0, 1] }])
	})

	test('a missing optional field (VariativeName, ColorVar, VolumeVar, Barcode) parses to null, never fabricated', () => {
		const result = parseProductsFeed([{ ID_nom: 1 }])
		expect(result.validRecords[0]).toMatchObject({
			VariativeNomenclature: null,
			VariativeName: null,
			Barcode: null,
			ColorVar: null,
			VolumeVar: null
		})
	})

	test('retains unrecognized fields via passthrough', () => {
		const result = parseProductsFeed([{ ID_nom: 1, SomeFutureField: 'kept' }])
		expect((result.validRecords[0] as Record<string, unknown>).SomeFutureField).toBe('kept')
	})
})

describe('parsePricevnFeed', () => {
	test('parses Price, PriceWH and DiscountPrice', () => {
		const result = parsePricevnFeed([{ ID_nom: 1, Price: '199.99', PriceWH: '150.00', DiscountPrice: '179.99' }])
		expect(result.validRecords[0]).toMatchObject({ Price: 19999, PriceWH: 15000, DiscountPrice: 17999 })
	})

	test('rejects a record with no Price at all', () => {
		const result = parsePricevnFeed([{ ID_nom: 1 }])
		expect(result.rejected).toHaveLength(1)
	})

	test('rejects an invalid price value rather than silently coercing it', () => {
		const result = parsePricevnFeed([{ ID_nom: 1, Price: 'free' }])
		expect(result.rejected).toHaveLength(1)
	})

	test('PriceWH and DiscountPrice are optional', () => {
		const result = parsePricevnFeed([{ ID_nom: 1, Price: '100' }])
		expect(result.validRecords[0]).toMatchObject({ Price: 10000, PriceWH: null, DiscountPrice: null })
	})
})

describe('parseJobvnSeoFeed', () => {
	test('parses a record with every confirmed SEO field present', () => {
		const result = parseJobvnSeoFeed([
			{
				ID_nom: 10516,
				WarehouseName: 'A10.253 nail polish ANNY',
				Brand: 'Anny',
				ShortDescriptionRus: 'ANNY Nail Polish Лак для ногтей',
				VariativeNomenclature: 'A10.XXX',
				VariativeName: 'NAIL POLISH ANNY',
				SeoHeaderRU: 'Лак для ногтей Anny',
				SeoDescriptionRU: 'Купить лак для ногтей Anny в Молдове',
				Price: 170,
				PriceWH: 85
			}
		])
		expect(result.validRecords).toHaveLength(1)
		expect(result.validRecords[0]).toMatchObject({
			SeoHeaderRU: 'Лак для ногтей Anny',
			SeoDescriptionRU: 'Купить лак для ногтей Anny в Молдове',
			Price: 17000,
			PriceWH: 8500
		})
	})

	test('empty SEO fields parse to null, never fabricated placeholder text (real-sample case: ID_nom 10568)', () => {
		const result = parseJobvnSeoFeed([
			{ ID_nom: 10568, ShortDescriptionRus: '', SeoHeaderRU: '', SeoDescriptionRU: '' }
		])
		expect(result.validRecords[0]).toMatchObject({
			ShortDescriptionRus: null,
			SeoHeaderRU: null,
			SeoDescriptionRU: null
		})
	})

	test('a record with only the linking id still parses (every other field is optional)', () => {
		const result = parseJobvnSeoFeed([{ ID_nom: 1 }])
		expect(result.rejected).toHaveLength(0)
	})

	test('rejects malformed field types it cannot safely interpret as text', () => {
		const result = parseJobvnSeoFeed([{ ID_nom: 1, SeoHeaderRU: { nested: 'object' } }])
		expect(result.rejected).toHaveLength(1)
	})

	test('WarehouseName is retained via passthrough but never typed as a title/name field', () => {
		const result = parseJobvnSeoFeed([{ ID_nom: 1, WarehouseName: 'A10.396 nail polish ANNY' }])
		expect((result.validRecords[0] as Record<string, unknown>).WarehouseName).toBe('A10.396 nail polish ANNY')
	})
})
