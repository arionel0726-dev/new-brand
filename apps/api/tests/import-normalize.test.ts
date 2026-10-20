import { describe, expect, test } from 'bun:test'
import { parseProductsFeed } from '../src/import/parsers/products-feed'
import { findCrossBatchGroupCollisions, normalizeProductsFeed } from '../src/import/normalize/products'

describe('normalizeProductsFeed (variant grouping)', () => {
	test('groups the observed A10.XXX example into one candidate product with 3 variants', () => {
		const { validRecords } = parseProductsFeed([
			{ ID_nom: 10568, VariativeNomenclature: 'A10.XXX', VariativeName: 'Lipstick A10', ColorVar: 'Red' },
			{ ID_nom: 10516, VariativeNomenclature: 'A10.XXX', VariativeName: 'Lipstick A10', ColorVar: 'Pink' },
			{ ID_nom: 10559, VariativeNomenclature: 'A10.XXX', VariativeName: 'Lipstick A10', ColorVar: 'Coral' }
		])

		const { candidates } = normalizeProductsFeed(validRecords, '1c')
		expect(candidates).toHaveLength(1)
		expect(candidates[0].groupKey).toBe('1c:A10.XXX')
		expect(candidates[0].variativeName).toBe('Lipstick A10')
		expect(candidates[0].variants.map(v => v.idNom).sort()).toEqual(['10516', '10559', '10568'])
		expect(candidates[0].publishable).toBe(true)
	})

	test('a record with no group identifier becomes its own standalone candidate, blocked for lack of a name', () => {
		const { validRecords } = parseProductsFeed([{ ID_nom: 20001 }])
		const { candidates } = normalizeProductsFeed(validRecords, '1c')

		expect(candidates).toHaveLength(1)
		expect(candidates[0].groupKey).toBeNull()
		expect(candidates[0].publishable).toBe(false)
		expect(candidates[0].issues[0].code).toBe('missing_required_field')
	})

	test('a group with no VariativeName on any member is blocked, never given a fabricated name', () => {
		const { validRecords } = parseProductsFeed([
			{ ID_nom: 1, VariativeNomenclature: 'B20.YYY' },
			{ ID_nom: 2, VariativeNomenclature: 'B20.YYY' }
		])
		const { candidates } = normalizeProductsFeed(validRecords, '1c')
		expect(candidates[0].publishable).toBe(false)
		expect(candidates[0].variativeName).toBeNull()
	})

	test('an inconsistent group name across members is flagged, not silently resolved', () => {
		const { validRecords } = parseProductsFeed([
			{ ID_nom: 1, VariativeNomenclature: 'C30.ZZZ', VariativeName: 'Name One' },
			{ ID_nom: 2, VariativeNomenclature: 'C30.ZZZ', VariativeName: 'Name Two' }
		])
		const { candidates } = normalizeProductsFeed(validRecords, '1c')
		expect(candidates[0].publishable).toBe(false)
		expect(candidates[0].issues.some(i => i.code === 'ambiguous_variant_parent')).toBe(true)
	})

	test('unrelated products are never accidentally merged - different group ids stay separate candidates', () => {
		const { validRecords } = parseProductsFeed([
			{ ID_nom: 1, VariativeNomenclature: 'A10.XXX', VariativeName: 'Group A' },
			{ ID_nom: 2, VariativeNomenclature: 'A20.XXX', VariativeName: 'Group B' }
		])
		const { candidates } = normalizeProductsFeed(validRecords, '1c')
		expect(candidates).toHaveLength(2)
		expect(new Set(candidates.map(c => c.groupKey)).size).toBe(2)
	})

	test('group ids are namespaced by source system, so two sources never collide on the same raw value', () => {
		const { validRecords: oneCRecords } = parseProductsFeed([
			{ ID_nom: 1, VariativeNomenclature: 'A10.XXX', VariativeName: 'From 1C' }
		])
		const { candidates: oneCCandidates } = normalizeProductsFeed(oneCRecords, '1c')
		const { candidates: legacyCandidates } = normalizeProductsFeed(oneCRecords, 'legacy_mysql')

		expect(oneCCandidates[0].groupKey).toBe('1c:A10.XXX')
		expect(legacyCandidates[0].groupKey).toBe('legacy_mysql:A10.XXX')
		expect(oneCCandidates[0].groupKey).not.toBe(legacyCandidates[0].groupKey)
	})

	test('findCrossBatchGroupCollisions flags a group key reused across two separately-processed batches', () => {
		const { validRecords } = parseProductsFeed([
			{ ID_nom: 1, VariativeNomenclature: 'A10.XXX', VariativeName: 'Batch One' }
		])
		const { candidates: batchOne } = normalizeProductsFeed(validRecords, '1c')
		const { candidates: batchTwo } = normalizeProductsFeed(validRecords, '1c')

		const collisions = findCrossBatchGroupCollisions([batchOne, batchTwo])
		expect(collisions).toEqual(['1c:A10.XXX'])
	})
})

// The real sanitized ANNY group from docs/legacy-reference/legacy-feed-samples.json
// (Sprint 10A.1 Task 2) - parent group A10.XXX, three distinct shades.
const REAL_ANNY_GROUP = [
	{
		ID_nom: 10568,
		WarehouseName: 'A10.396 nail polish ANNY',
		Barcode: '4051761201249',
		Brand: 'Anny',
		ColorVar: '396',
		VolumeVar: '15',
		Sex: 'Женский',
		VariativeNomenclature: 'A10.XXX',
		VariativeName: 'NAIL POLISH ANNY',
		QuantityBalance: 0,
		Price: 170,
		PriceWH: 85
	},
	{
		ID_nom: 10516,
		WarehouseName: 'A10.253 nail polish ANNY',
		Barcode: '4051761201232',
		Brand: 'Anny',
		ColorVar: '253',
		VolumeVar: '15',
		Sex: 'Женский',
		VariativeNomenclature: 'A10.XXX',
		VariativeName: 'NAIL POLISH ANNY',
		QuantityBalance: 0,
		Price: 170,
		PriceWH: 85
	},
	{
		ID_nom: 10559,
		WarehouseName: 'A10.369.50 nail polish ANNY',
		Barcode: '4051761202772',
		Brand: 'Anny',
		ColorVar: '369.50',
		VolumeVar: '15',
		Sex: 'Женский',
		VariativeNomenclature: 'A10.XXX',
		VariativeName: 'NAIL POLISH ANNY',
		QuantityBalance: 0,
		Price: 170,
		PriceWH: 85
	}
]

describe('normalizeProductsFeed: real ANNY fixture (Sprint 10A.1 Task 2)', () => {
	test('produces exactly one publishable parent candidate and 3 distinct variants with the real shade values', () => {
		const { validRecords } = parseProductsFeed(REAL_ANNY_GROUP)
		const { candidates } = normalizeProductsFeed(validRecords, '1c')

		expect(candidates).toHaveLength(1)
		const parent = candidates[0]
		expect(parent.groupKey).toBe('1c:A10.XXX')
		expect(parent.title).toBe('NAIL POLISH ANNY')
		expect(parent.titleSource).toBe('variative_name')
		expect(parent.publishable).toBe(true)
		expect(parent.variants).toHaveLength(3)
		expect(parent.variants.map(v => v.colorVar).sort()).toEqual(['253', '369.50', '396'])
		expect(parent.variants.map(v => v.idNom).sort()).toEqual(['10516', '10559', '10568'])
	})

	test('never confuses the group identifier (VariativeNomenclature) with a sellable SKU', () => {
		const { validRecords } = parseProductsFeed(REAL_ANNY_GROUP)
		const { candidates } = normalizeProductsFeed(validRecords, '1c')
		const parent = candidates[0]

		// The raw group value "A10.XXX" must never appear as a variant's own
		// identity - each variant keeps its own ID_nom only.
		for (const variant of parent.variants) {
			expect(variant.idNom).not.toBe('A10.XXX')
		}
	})
})

describe('normalizeProductsFeed: source-aware standalone naming (Sprint 10A.1 Task 3)', () => {
	test('a standalone record with no VariativeName is no longer unconditionally blocked when MySQL enrichment supplies a title', () => {
		const { validRecords } = parseProductsFeed([{ ID_nom: 20001, Barcode: '0099988877701' }])
		const { candidates } = normalizeProductsFeed(validRecords, '1c', {
			mysqlTitles: new Map([['20001', { titleRu: 'Тестовый товар', titleRo: null }]])
		})

		expect(candidates[0].publishable).toBe(true)
		expect(candidates[0].title).toBe('Тестовый товар')
		expect(candidates[0].titleSource).toBe('mysql_enrichment')
		expect(candidates[0].issues.every(i => i.severity !== 'error')).toBe(true)
	})

	test('a standalone record falls back to the JobVN ShortDescriptionRus when no MySQL title exists, flagged as a warning, still publishable', () => {
		const { validRecords } = parseProductsFeed([{ ID_nom: 10516 }])
		const { candidates } = normalizeProductsFeed(validRecords, '1c', {
			shortDescriptions: new Map([['10516', 'ANNY Nail Polish Лак для ногтей']])
		})

		expect(candidates[0].publishable).toBe(true)
		expect(candidates[0].title).toBe('ANNY Nail Polish Лак для ногтей')
		expect(candidates[0].titleSource).toBe('short_description_fallback')
		expect(candidates[0].issues.some(i => i.severity === 'warning')).toBe(true)
	})

	test('a standalone record with a blank ShortDescriptionRus (real sample case: ID_nom 10568) still has nowhere to get a title and stays unresolved', () => {
		const { validRecords } = parseProductsFeed([{ ID_nom: 10568 }])
		const { candidates } = normalizeProductsFeed(validRecords, '1c', {
			shortDescriptions: new Map([['10568', '']])
		})

		expect(candidates[0].publishable).toBe(false)
		expect(candidates[0].titleSource).toBe('unresolved')
		expect(candidates[0].issues.some(i => i.code === 'missing_required_field')).toBe(true)
	})

	test('MySQL enrichment is preferred over the feed short-description fallback', () => {
		const { validRecords } = parseProductsFeed([{ ID_nom: 1 }])
		const { candidates } = normalizeProductsFeed(validRecords, '1c', {
			mysqlTitles: new Map([['1', { titleRu: 'Верифицированное название', titleRo: null }]]),
			shortDescriptions: new Map([['1', 'Описание из фида']])
		})

		expect(candidates[0].title).toBe('Верифицированное название')
		expect(candidates[0].titleSource).toBe('mysql_enrichment')
	})

	test('never fabricates a title and never uses WarehouseName as one, even when present', () => {
		const { validRecords } = parseProductsFeed([
			{ ID_nom: 30001, WarehouseName: 'A30.001 something not a title' }
		])
		const { candidates } = normalizeProductsFeed(validRecords, '1c')

		expect(candidates[0].title).toBeNull()
		expect(candidates[0].publishable).toBe(false)
	})

	test('a group missing VariativeName on every member can still resolve its title via enrichment', () => {
		const { validRecords } = parseProductsFeed([
			{ ID_nom: 1, VariativeNomenclature: 'B20.YYY' },
			{ ID_nom: 2, VariativeNomenclature: 'B20.YYY' }
		])
		const { candidates } = normalizeProductsFeed(validRecords, '1c', {
			mysqlTitles: new Map([['1', { titleRu: 'Групповое название', titleRo: null }]])
		})

		expect(candidates[0].publishable).toBe(true)
		expect(candidates[0].title).toBe('Групповое название')
		expect(candidates[0].titleSource).toBe('mysql_enrichment')
	})
})
