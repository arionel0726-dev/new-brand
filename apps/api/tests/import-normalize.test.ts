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
